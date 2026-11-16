package httpserver

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"backend/internal/domain"
	"backend/internal/security"
	"backend/internal/ws"
	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"
)

type eventUserRepo struct {
	domain.UserRepository
	mu        sync.Mutex
	users     map[string]*domain.User
	statuses  map[int64]bool
	lookupErr error
}

func (r *eventUserRepo) GetByUsername(_ context.Context, name string) (*domain.User, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.lookupErr != nil {
		return nil, r.lookupErr
	}
	if u := r.users[name]; u != nil {
		copy := *u
		return &copy, nil
	}
	return nil, domain.ErrNotFound
}

func (r *eventUserRepo) GetByID(ctx context.Context, id int64) (*domain.User, error) {
	for _, name := range []string{"alice", "bob"} {
		u, err := r.GetByUsername(ctx, name)
		if err == nil && u.ID == id {
			return u, nil
		}
	}
	return nil, domain.ErrNotFound
}

func (r *eventUserRepo) SetOnlineStatus(_ context.Context, id int64, online bool) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.statuses[id] = online
	return nil
}

func newEventHandlersForTest() (*eventHandlers, *security.TokenService) {
	hub := ws.NewHub(time.Hour, time.Hour)
	go hub.Run()
	return &eventHandlers{
		tickets: newEventTicketStore(), hub: hub, pingInterval: eventPingInterval,
		users: &eventUserRepo{
			users: map[string]*domain.User{
				"alice":    {ID: 1, Username: "alice", IsActive: true},
				"bob":      {ID: 2, Username: "bob", IsActive: true},
				"inactive": {ID: 3, Username: "inactive"},
			}, statuses: make(map[int64]bool),
		},
	}, security.NewTokenService("events-test-secret", time.Hour)
}

func eventRoutes(h *eventHandlers, tokens *security.TokenService) http.Handler {
	r := chi.NewRouter()
	r.With(AuthMiddleware(tokens, h.users)).Post("/api/events/ticket", h.ticket)
	r.Get("/api/events", h.stream)
	return r
}

func TestEventTicketEndpointRequiresActiveBearerUser(t *testing.T) {
	h, tokens := newEventHandlersForTest()
	router := eventRoutes(h, tokens)
	valid, err := tokens.CreateForUser("alice")
	require.NoError(t, err)
	unknown, err := tokens.CreateForUser("ghost")
	require.NoError(t, err)
	inactive, err := tokens.CreateForUser("inactive")
	require.NoError(t, err)
	wrong, err := security.NewTokenService("wrong-secret", time.Hour).CreateForUser("alice")
	require.NoError(t, err)
	for _, tc := range []struct{ name, auth string }{
		{"missing", ""}, {"invalid", "Bearer garbage"}, {"query JWT only", ""},
		{"wrong key", "Bearer " + wrong}, {"unknown", "Bearer " + unknown}, {"inactive", "Bearer " + inactive},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/api/events/ticket?token="+valid, nil)
			req.Header.Set("Authorization", tc.auth)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)
			require.Equal(t, http.StatusUnauthorized, rec.Code)
		})
	}
	req := httptest.NewRequest(http.MethodPost, "/api/events/ticket", nil)
	req.Header.Set("Authorization", "Bearer "+valid)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)
	require.Equal(t, "no-store", rec.Header().Get("Cache-Control"))
	var resp eventTicketResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	require.Equal(t, 30, resp.ExpiresIn)
	owner, ok := h.tickets.consume(resp.Ticket)
	require.True(t, ok)
	require.Equal(t, int64(1), owner.userID)
}

func TestEventsRejectInvalidTicketsAndOwners(t *testing.T) {
	for _, name := range []string{"missing", "unknown", "used", "expired", "inactive", "missing owner", "wrong user ID", "lookup error"} {
		t.Run(name, func(t *testing.T) {
			h, tokens := newEventHandlersForTest()
			ticket := h.tickets.issue(&domain.User{ID: 1, Username: "alice"})
			repo := h.users.(*eventUserRepo)
			switch name {
			case "missing":
				ticket = ""
			case "unknown":
				ticket = "unknown"
			case "used":
				h.tickets.consume(ticket)
			case "expired":
				h.tickets.now = func() time.Time { return time.Now().Add(time.Minute) }
			case "inactive":
				repo.users["alice"].IsActive = false
			case "missing owner":
				delete(repo.users, "alice")
			case "wrong user ID":
				repo.users["alice"].ID = 99
			case "lookup error":
				repo.lookupErr = errors.New("database unavailable")
			}
			srv := httptest.NewServer(eventRoutes(h, tokens))
			defer srv.Close()
			resp, err := srv.Client().Get(srv.URL + "/api/events?ticket=" + ticket)
			require.NoError(t, err)
			defer resp.Body.Close()
			require.Equal(t, http.StatusUnauthorized, resp.StatusCode)
			require.NotEqual(t, "text/event-stream", resp.Header.Get("Content-Type"))
		})
	}
}

func openEventStream(t *testing.T, client *http.Client, url string) (*http.Response, *bufio.Reader) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	t.Cleanup(cancel)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	require.NoError(t, err)
	resp, err := client.Do(req)
	require.NoError(t, err)
	t.Cleanup(func() { _ = resp.Body.Close() })
	require.Equal(t, http.StatusOK, resp.StatusCode)
	return resp, bufio.NewReader(resp.Body)
}

func readEventFrame(t *testing.T, reader *bufio.Reader) string {
	t.Helper()
	var frame strings.Builder
	for {
		line, err := reader.ReadString('\n')
		require.NoError(t, err)
		if line == "\n" {
			return frame.String()
		}
		frame.WriteString(line)
	}
}

func TestEventStreamFramesFilterBindingAndDisconnect(t *testing.T) {
	h, tokens := newEventHandlersForTest()
	srv := httptest.NewServer(eventRoutes(h, tokens))
	defer srv.Close()
	ticket := h.tickets.issue(&domain.User{ID: 1, Username: "alice"})
	resp, reader := openEventStream(t, srv.Client(), srv.URL+"/api/events?ticket="+ticket+"&user_id=2&token=ignored")
	require.Equal(t, "text/event-stream", resp.Header.Get("Content-Type"))
	require.Equal(t, "no-cache", resp.Header.Get("Cache-Control"))
	require.Equal(t, "no", resp.Header.Get("X-Accel-Buffering"))
	require.Equal(t, "retry: 5000\n", readEventFrame(t, reader))
	require.True(t, h.hub.IsOnline(1))
	require.False(t, h.hub.IsOnline(2), "query identity override must be ignored")
	for _, kind := range []string{"typing", "messages_read", "user_online", "user_offline", "reaction_updated", "call_offer"} {
		h.hub.BroadcastAll(map[string]any{"type": kind})
	}
	h.hub.BroadcastToUsers([]int64{2}, map[string]any{"type": "message", "content": "private to Bob"})
	for _, kind := range []string{"message", "message_edited", "message_deleted"} {
		payload := map[string]any{"type": kind, "message_id": 42, "content": "line one\nline two"}
		h.hub.BroadcastToUsers([]int64{1}, payload)
		data, err := json.Marshal(payload)
		require.NoError(t, err)
		require.Equal(t, "event: "+kind+"\ndata: "+string(data)+"\n", readEventFrame(t, reader))
	}
	used, err := srv.Client().Get(srv.URL + "/api/events?ticket=" + ticket)
	require.NoError(t, err)
	require.Equal(t, http.StatusUnauthorized, used.StatusCode)
	require.NoError(t, used.Body.Close())
	require.NoError(t, resp.Body.Close())
	require.Eventually(t, func() bool { return !h.hub.IsOnline(1) }, time.Second, time.Millisecond)
}

// A real net/http server is necessary: ResponseRecorder cannot prove deadline
// clearing. Pings after the original write deadline must still reach the client.
func TestEventStreamClearsServerWriteDeadline(t *testing.T) {
	h, tokens := newEventHandlersForTest()
	h.pingInterval = 25 * time.Millisecond
	srv := httptest.NewUnstartedServer(eventRoutes(h, tokens))
	srv.Config.WriteTimeout = 40 * time.Millisecond
	srv.Start()
	defer srv.Close()
	ticket := h.tickets.issue(&domain.User{ID: 1, Username: "alice"})
	resp, reader := openEventStream(t, srv.Client(), srv.URL+"/api/events?ticket="+ticket)
	require.Equal(t, "retry: 5000\n", readEventFrame(t, reader))
	for range 4 {
		require.Equal(t, ": ping\n", readEventFrame(t, reader))
	}
	require.NoError(t, resp.Body.Close())
}

type failingStreamWriter struct {
	header             http.Header
	writeErr, flushErr bool
}

func (w *failingStreamWriter) Header() http.Header              { return w.header }
func (w *failingStreamWriter) WriteHeader(int)                  {}
func (w *failingStreamWriter) SetWriteDeadline(time.Time) error { return nil }
func (w *failingStreamWriter) Write(p []byte) (int, error) {
	if w.writeErr {
		return 0, io.ErrClosedPipe
	}
	return len(p), nil
}
func (w *failingStreamWriter) FlushError() error {
	if w.flushErr {
		return io.ErrClosedPipe
	}
	return nil
}

func TestEventStreamDetachesOnWriteAndFlushFailure(t *testing.T) {
	for _, mode := range []string{"write", "flush"} {
		t.Run(mode, func(t *testing.T) {
			h, _ := newEventHandlersForTest()
			ticket := h.tickets.issue(&domain.User{ID: 1, Username: "alice"})
			w := &failingStreamWriter{header: make(http.Header), writeErr: mode == "write", flushErr: mode == "flush"}
			h.stream(w, httptest.NewRequest(http.MethodGet, "/api/events?ticket="+ticket, nil))
			require.False(t, h.hub.IsOnline(1))
		})
	}
}

type blockedStreamWriter struct {
	failingStreamWriter
	ready, release chan struct{}
	once           sync.Once
}

func (w *blockedStreamWriter) Write(p []byte) (int, error) {
	w.once.Do(func() { close(w.ready); <-w.release })
	return len(p), nil
}

func TestEventStreamDetachesWhenHubClosesSlowSubscriber(t *testing.T) {
	h, _ := newEventHandlersForTest()
	ticket := h.tickets.issue(&domain.User{ID: 1, Username: "alice"})
	w := &blockedStreamWriter{
		failingStreamWriter: failingStreamWriter{header: make(http.Header)},
		ready:               make(chan struct{}), release: make(chan struct{}),
	}
	done := make(chan struct{})
	go func() {
		h.stream(w, httptest.NewRequest(http.MethodGet, "/api/events?ticket="+ticket, nil))
		close(done)
	}()
	<-w.ready
	for range 258 {
		h.hub.BroadcastToUsers([]int64{1}, map[string]any{"type": "message"})
	}
	require.False(t, h.hub.IsOnline(1), "the hub evicts a subscriber with a full queue")
	close(w.release)
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("stream did not exit after its queue closed")
	}
	repo := h.users.(*eventUserRepo)
	repo.mu.Lock()
	defer repo.mu.Unlock()
	require.False(t, repo.statuses[1], "shared detach updates the final offline status")
}
