package ws

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"backend/internal/domain"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/require"
)

func nextEvent(t *testing.T, ch <-chan []byte) map[string]any {
	t.Helper()
	select {
	case data, ok := <-ch:
		require.True(t, ok, "subscriber unexpectedly closed")
		var event map[string]any
		require.NoError(t, json.Unmarshal(data, &event))
		return event
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for event")
		return nil
	}
}

func TestHubMixedKeysAndTargeting(t *testing.T) {
	h := NewHub(time.Hour, time.Hour)
	go h.Run()
	wsKey := &websocket.Conn{}
	sseKey := make(chan []byte, 4)
	wsSend, other := make(chan []byte, 4), make(chan []byte, 4)
	h.Register(1, wsKey, wsSend)
	h.Register(1, sseKey, sseKey)
	h.Register(2, "other", other)
	require.True(t, h.IsOnline(1))
	h.BroadcastToUsers([]int64{1}, map[string]any{"type": "message"})
	require.Equal(t, "message", nextEvent(t, wsSend)["type"])
	require.Equal(t, "message", nextEvent(t, sseKey)["type"])
	require.Empty(t, other)
	h.BroadcastAll(map[string]any{"type": "typing"})
	for _, ch := range []chan []byte{wsSend, sseKey, other} {
		require.Equal(t, "typing", nextEvent(t, ch)["type"])
	}
	h.Unregister(1, wsKey)
	require.True(t, h.IsOnline(1))
	_, ok := <-wsSend
	require.False(t, ok)
	h.Unregister(1, sseKey)
	h.Unregister(1, sseKey) // repeated detach must not close twice
	require.False(t, h.IsOnline(1))
	h.Unregister(2, "other")
}

func TestHubSlowConsumerDoesNotBlockOthers(t *testing.T) {
	h := NewHub(time.Hour, time.Hour)
	go h.Run()
	slow, fast := make(chan []byte, 1), make(chan []byte, 4)
	h.Register(1, "slow", slow)
	h.Register(2, "fast", fast)
	h.BroadcastAll(map[string]any{"n": 1})
	h.BroadcastAll(map[string]any{"n": 2})
	require.False(t, h.IsOnline(1))
	require.True(t, h.IsOnline(2))
	require.Equal(t, float64(1), nextEvent(t, fast)["n"])
	require.Equal(t, float64(2), nextEvent(t, fast)["n"])
	<-slow // queued frame is still readable before the closed channel
	_, ok := <-slow
	require.False(t, ok)
	h.BroadcastAll(make(chan int)) // malformed payload does not evict clients
	require.True(t, h.IsOnline(2))
	h.Unregister(2, "fast")
}

type presenceRepo struct {
	domain.UserRepository
	statuses []bool
}

func (r *presenceRepo) SetOnlineStatus(_ context.Context, _ int64, online bool) error {
	r.statuses = append(r.statuses, online)
	return nil
}

func TestAttachPreservesPresenceUntilFinalTransportDetaches(t *testing.T) {
	h := NewHub(time.Hour, time.Hour)
	go h.Run()
	observer := make(chan []byte, 8)
	h.Register(2, "observer", observer)
	repo := &presenceRepo{}
	u := &domain.User{ID: 1, Username: "alice"}
	wsSend, sseSend := make(chan []byte, 8), make(chan []byte, 8)
	detachWS := Attach(h, repo, u, &websocket.Conn{}, wsSend)
	detachSSE := Attach(h, repo, u, sseSend, sseSend)
	for range 2 {
		require.Equal(t, map[string]any{"type": "user_online", "user_id": float64(1), "username": "alice"}, nextEvent(t, observer))
	}
	detachWS()
	require.True(t, h.IsOnline(1))
	require.Equal(t, []bool{true, true}, repo.statuses)
	require.Empty(t, observer)
	detachSSE()
	require.False(t, h.IsOnline(1))
	require.Equal(t, []bool{true, true, false}, repo.statuses)
	require.Equal(t, "user_offline", nextEvent(t, observer)["type"])
	h.Unregister(2, "observer")
}
