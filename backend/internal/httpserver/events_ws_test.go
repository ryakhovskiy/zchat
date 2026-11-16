package httpserver

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"backend/internal/domain"
	"backend/internal/ws"
	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/require"
)

func readWSEvent(t *testing.T, conn *websocket.Conn, kind string) map[string]any {
	t.Helper()
	require.NoError(t, conn.SetReadDeadline(time.Now().Add(2*time.Second)))
	for {
		var event map[string]any
		require.NoError(t, conn.ReadJSON(&event))
		if event["type"] == kind {
			return event
		}
	}
}

func readSSEEvent(t *testing.T, frame string, kind string) map[string]any {
	t.Helper()
	lines := strings.Split(strings.TrimSuffix(frame, "\n"), "\n")
	require.Len(t, lines, 2)
	require.Equal(t, "event: "+kind, lines[0])
	require.True(t, strings.HasPrefix(lines[1], "data: "))
	var event map[string]any
	require.NoError(t, json.Unmarshal([]byte(strings.TrimPrefix(lines[1], "data: ")), &event))
	require.Equal(t, kind, event["type"])
	return event
}

func TestWebSocketRegressionAndSSEInteroperability(t *testing.T) {
	h, tokens := newEventHandlersForTest()
	svc, _, encryptor := messageServiceForEvents(t, h.users)
	router := eventMessageRoutes(svc, h.hub, 2).(*chi.Mux)
	router.Get("/api/events", h.stream)
	const origin = "http://android-test.invalid"
	router.Get("/ws", ws.MakeHandler(h.hub, tokens, h.users, eventConversationRepo{}, svc, encryptor, nil, []string{origin}, 10*time.Millisecond, 2*time.Second))
	srv := httptest.NewServer(router)
	defer srv.Close()
	// Bob's SSE connection receives Alice's Android-style WebSocket writes.
	bobTicket := h.tickets.issue(&domain.User{ID: 2, Username: "bob"})
	bobStream, bobReader := openEventStream(t, srv.Client(), srv.URL+"/api/events?ticket="+bobTicket)
	defer bobStream.Body.Close()
	require.Equal(t, "retry: 5000\n", readEventFrame(t, bobReader))
	token, err := tokens.CreateForUser("alice")
	require.NoError(t, err)
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http")+"/ws", http.Header{
		"Origin": []string{origin}, "Authorization": []string{"Bearer " + token},
	})
	require.NoError(t, err)
	defer conn.Close()
	var pings atomic.Int32
	conn.SetPingHandler(func(data string) error {
		pings.Add(1)
		return conn.WriteControl(websocket.PongMessage, []byte(data), time.Now().Add(time.Second))
	})
	require.Equal(t, "alice", readWSEvent(t, conn, "user_online")["username"])
	require.NoError(t, conn.WriteJSON(map[string]any{"type": "message", "conversation_id": 10, "content": "from Android"}))
	message := readWSEvent(t, conn, "message")
	require.Equal(t, map[string]any{
		"type": "message", "message_id": float64(42), "conversation_id": float64(10), "sender_id": float64(1),
		"sender_username": "alice", "content": "from Android", "timestamp": "2026-01-02T03:04:05Z",
		"file_path": nil, "file_type": nil, "reply_to_id": nil, "is_deleted": false, "is_read": false,
	}, message)
	require.Equal(t, message, readSSEEvent(t, readEventFrame(t, bobReader), "message"))
	// Let the server's Ping arrive; the next read must answer it with Pong.
	time.Sleep(25 * time.Millisecond)
	require.NoError(t, conn.WriteJSON(map[string]any{"type": "edit_message", "message_id": 42, "content": "edited on Android"}))
	edited := readWSEvent(t, conn, "message_edited")
	require.Equal(t, "edited on Android", edited["content"])
	require.Equal(t, true, edited["is_edited"])
	require.Positive(t, pings.Load())
	require.Equal(t, edited, readSSEEvent(t, readEventFrame(t, bobReader), "message_edited"))
	require.NoError(t, conn.WriteJSON(map[string]any{"type": "delete_message", "message_id": 42}))
	require.Equal(t, "for_me", readWSEvent(t, conn, "message_deleted")["delete_type"])
	// The next frame for Bob must skip Alice's private delete.
	h.hub.BroadcastToUsers([]int64{2}, map[string]any{"type": "message", "message_id": 99})
	require.Equal(t, float64(99), readSSEEvent(t, readEventFrame(t, bobReader), "message")["message_id"])
	require.NoError(t, conn.WriteJSON(map[string]any{"type": "delete_message", "message_id": 42, "delete_type": "for_everyone"}))
	deleted := readWSEvent(t, conn, "message_deleted")
	require.Equal(t, "for_everyone", deleted["delete_type"])
	require.Equal(t, deleted, readSSEEvent(t, readEventFrame(t, bobReader), "message_deleted"))
	// REST writes from the Lite client must also reach an Android WebSocket and
	// the sender's own SSE connection with identical wire payloads.
	resp, err := srv.Client().Post(srv.URL+"/api/conversations/10/messages", "application/json", strings.NewReader(`{"content":"from Lite"}`))
	require.NoError(t, err)
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	restMessage := readWSEvent(t, conn, "message")
	require.Equal(t, "from Lite", restMessage["content"])
	require.Equal(t, float64(2), restMessage["sender_id"])
	require.Equal(t, restMessage, readSSEEvent(t, readEventFrame(t, bobReader), "message"))
	// An SSE connection for Alice keeps her online after the WS disconnects.
	aliceTicket := h.tickets.issue(&domain.User{ID: 1, Username: "alice"})
	aliceStream, aliceReader := openEventStream(t, srv.Client(), srv.URL+"/api/events?ticket="+aliceTicket)
	defer aliceStream.Body.Close()
	require.Equal(t, "retry: 5000\n", readEventFrame(t, aliceReader))
	require.Equal(t, "alice", readWSEvent(t, conn, "user_online")["username"])
	require.NoError(t, conn.Close())
	// The offline database update is observable only after the last transport.
	require.True(t, h.hub.IsOnline(1))
	require.NoError(t, aliceStream.Body.Close())
	require.Eventually(t, func() bool { return !h.hub.IsOnline(1) }, time.Second, time.Millisecond)
	require.NoError(t, bobStream.Body.Close())
}

func TestWebSocketAuthAndSubprotocolRemainUnchanged(t *testing.T) {
	h, tokens := newEventHandlersForTest()
	const origin = "http://ws-test.invalid"
	srv := httptest.NewServer(ws.MakeHandler(h.hub, tokens, h.users, nil, nil, nil, nil, []string{origin}, time.Hour, time.Hour))
	defer srv.Close()
	url := "ws" + strings.TrimPrefix(srv.URL, "http")
	for _, tc := range []struct {
		name, origin, user string
		want               int
	}{
		{"missing origin", "", "alice", 403}, {"wrong origin", "http://other.invalid", "alice", 403},
		{"missing token", origin, "", 401}, {"missing user", origin, "ghost", 401}, {"inactive", origin, "inactive", 401},
	} {
		t.Run(tc.name, func(t *testing.T) {
			headers := http.Header{"Origin": []string{tc.origin}}
			if tc.user != "" {
				token, err := tokens.CreateForUser(tc.user)
				require.NoError(t, err)
				headers.Set("Authorization", "Bearer "+token)
			}
			conn, resp, err := websocket.DefaultDialer.Dial(url, headers)
			if conn != nil {
				defer conn.Close()
			}
			require.Error(t, err)
			require.NotNil(t, resp)
			defer resp.Body.Close()
			require.Equal(t, tc.want, resp.StatusCode)
		})
	}
	token, err := tokens.CreateForUser("alice")
	require.NoError(t, err)
	dialer := websocket.Dialer{Subprotocols: []string{"bearer", token}}
	conn, _, err := dialer.Dial(url, http.Header{"Origin": []string{origin}})
	require.NoError(t, err)
	defer conn.Close()
	require.Equal(t, "bearer", conn.Subprotocol())
	require.Equal(t, "alice", readWSEvent(t, conn, "user_online")["username"])
}
