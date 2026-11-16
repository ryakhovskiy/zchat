package httpserver

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"backend/internal/config"
	"backend/internal/security"
	"backend/internal/ws"
	"github.com/stretchr/testify/require"
)

// Like the upload tests, exercise real router wiring without any database or
// production stack. Capture SELECT contexts to detect an inherited chi timeout.
type eventSQLStub struct{ deadlines chan bool }

func (s eventSQLStub) Connect(context.Context) (driver.Conn, error) { return eventSQLConn(s), nil }
func (s eventSQLStub) Driver() driver.Driver                        { return s }
func (s eventSQLStub) Open(string) (driver.Conn, error)             { return eventSQLConn(s), nil }

type eventSQLConn struct{ deadlines chan bool }

func (c eventSQLConn) Prepare(string) (driver.Stmt, error) { return nil, errors.New("not supported") }
func (c eventSQLConn) Close() error                        { return nil }
func (c eventSQLConn) Begin() (driver.Tx, error)           { return nil, errors.New("not supported") }
func (c eventSQLConn) QueryContext(ctx context.Context, _ string, _ []driver.NamedValue) (driver.Rows, error) {
	_, deadline := ctx.Deadline()
	c.deadlines <- deadline
	return &eventSQLRows{}, nil
}
func (c eventSQLConn) ExecContext(context.Context, string, []driver.NamedValue) (driver.Result, error) {
	return driver.RowsAffected(1), nil
}

type eventSQLRows struct{ done bool }

func (*eventSQLRows) Columns() []string {
	return []string{"id", "username", "email", "hashed_password", "is_active", "is_online", "created_at", "last_seen"}
}
func (*eventSQLRows) Close() error { return nil }
func (r *eventSQLRows) Next(dest []driver.Value) error {
	if r.done {
		return io.EOF
	}
	r.done = true
	copy(dest, []driver.Value{int64(1), "alice", nil, "unused", true, false, time.Now(), time.Now()})
	return nil
}

func TestProductionRouterExemptsOnlySSEFromTimeout(t *testing.T) {
	deadlines := make(chan bool, 4)
	db := sql.OpenDB(eventSQLStub{deadlines: deadlines})
	t.Cleanup(func() { _ = db.Close() })
	hub := ws.NewHub(time.Hour, time.Hour)
	go hub.Run()
	tokens := security.NewTokenService("router-event-secret", time.Hour)
	router := NewRouter(&config.Config{}, db, hub, tokens, nil, nil)
	srv := httptest.NewServer(router)
	defer srv.Close()
	token, err := tokens.CreateForUser("alice")
	require.NoError(t, err)
	req, err := http.NewRequest(http.MethodPost, srv.URL+"/api/events/ticket", nil)
	require.NoError(t, err)
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := srv.Client().Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var ticket eventTicketResponse
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&ticket))
	require.True(t, <-deadlines, "ticket request keeps the regular 60-second timeout")
	stream, reader := openEventStream(t, srv.Client(), srv.URL+"/api/events?ticket="+ticket.Ticket)
	defer stream.Body.Close()
	require.Equal(t, "retry: 5000\n", readEventFrame(t, reader))
	require.False(t, <-deadlines, "SSE context must not carry chi Timeout(60s)")
	hub.BroadcastToUsers([]int64{1}, map[string]any{"type": "message", "message_id": 42})
	require.Contains(t, readEventFrame(t, reader), "event: message\n")
	// The normal auth route also stays protected after middleware regrouping.
	unauth, err := srv.Client().Get(srv.URL + "/api/auth/me")
	require.NoError(t, err)
	defer unauth.Body.Close()
	require.Equal(t, http.StatusUnauthorized, unauth.StatusCode)
}
