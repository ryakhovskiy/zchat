package httpserver

import (
	"bytes"
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"backend/internal/config"
	"backend/internal/domain"
	"backend/internal/security"

	"github.com/stretchr/testify/require"
)

type uploadUserRepo struct {
	domain.UserRepository
	users map[string]*domain.User
}

func (r *uploadUserRepo) GetByUsername(_ context.Context, username string) (*domain.User, error) {
	if u, ok := r.users[username]; ok {
		return u, nil
	}
	return nil, domain.ErrNotFound
}

func newUploadServer(t *testing.T) (http.Handler, *security.TokenService, string) {
	t.Helper()
	dir := t.TempDir()
	tokens := security.NewTokenService("test-secret", time.Hour)
	repo := &uploadUserRepo{users: map[string]*domain.User{
		"alice":    {ID: 1, Username: "alice", IsActive: true},
		"inactive": {ID: 2, Username: "inactive", IsActive: false},
	}}
	return UploadRoutes(&config.Config{UploadDir: dir}, nil, tokens, repo), tokens, dir
}

func uploadRequest(t *testing.T, authHeader string) *http.Request {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, err := mw.CreateFormFile("file", "note.txt")
	require.NoError(t, err)
	_, err = fw.Write([]byte("hello"))
	require.NoError(t, err)
	require.NoError(t, mw.Close())
	req := httptest.NewRequest(http.MethodPost, "/", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	if authHeader != "" {
		req.Header.Set("Authorization", authHeader)
	}
	return req
}

func TestUploadPostRequiresAuth(t *testing.T) {
	h, tokens, dir := newUploadServer(t)

	validToken, err := tokens.CreateForUser("alice")
	require.NoError(t, err)
	unknownToken, err := tokens.CreateForUser("ghost")
	require.NoError(t, err)
	inactiveToken, err := tokens.CreateForUser("inactive")
	require.NoError(t, err)
	wrongKeyToken, err := security.NewTokenService("other-secret", time.Hour).CreateForUser("alice")
	require.NoError(t, err)

	for _, tc := range []struct {
		name   string
		header string
		want   int
	}{
		{"no token", "", http.StatusUnauthorized},
		{"malformed header", "Token abc", http.StatusUnauthorized},
		{"invalid token", "Bearer not-a-jwt", http.StatusUnauthorized},
		{"token signed with another key", "Bearer " + wrongKeyToken, http.StatusUnauthorized},
		{"unknown user", "Bearer " + unknownToken, http.StatusUnauthorized},
		{"inactive user", "Bearer " + inactiveToken, http.StatusUnauthorized},
		{"valid token", "Bearer " + validToken, http.StatusOK},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, uploadRequest(t, tc.header))
			require.Equal(t, tc.want, rec.Code, rec.Body.String())
			if tc.want == http.StatusOK {
				var resp map[string]any
				require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
				require.Equal(t, "note.txt", resp["original_name"])
			}
		})
	}

	// Only the authenticated request may have written a file.
	entries, err := readDirNames(dir)
	require.NoError(t, err)
	require.Len(t, entries, 1)
}

// attachmentStub is a minimal database/sql driver and connector: the attachments metadata
// SELECT returns one row with original_name "report final.txt", and UPDATEs
// (read_count) are counted.
type attachmentStub struct{ updates *int }

// attachmentStub is a driver.Connector, so each test gets its own instance and
// nothing is registered globally (safe with -count=N).
func (d attachmentStub) Connect(context.Context) (driver.Conn, error) { return stubConn(d), nil }
func (d attachmentStub) Driver() driver.Driver                        { return d }
func (d attachmentStub) Open(string) (driver.Conn, error)             { return stubConn(d), nil }

type stubConn struct{ updates *int }

func (c stubConn) Prepare(q string) (driver.Stmt, error) { return stubStmt{c: c, query: q}, nil }
func (c stubConn) Close() error                          { return nil }
func (c stubConn) Begin() (driver.Tx, error)             { return nil, errors.New("not supported") }

type stubStmt struct {
	c     stubConn
	query string
}

func (s stubStmt) Close() error  { return nil }
func (s stubStmt) NumInput() int { return -1 }
func (s stubStmt) Exec([]driver.Value) (driver.Result, error) {
	*s.c.updates++
	return driver.RowsAffected(1), nil
}
func (s stubStmt) Query([]driver.Value) (driver.Rows, error) {
	return &stubRows{}, nil
}

type stubRows struct{ done bool }

func (r *stubRows) Columns() []string { return []string{"original_name"} }
func (r *stubRows) Close() error      { return nil }
func (r *stubRows) Next(dest []driver.Value) error {
	if r.done {
		return io.EOF
	}
	r.done = true
	dest[0] = "report final.txt"
	return nil
}

func TestUploadDownloadAuth(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "abc.txt"), []byte("file body"), 0o600))

	updates := 0
	db := sql.OpenDB(attachmentStub{updates: &updates})
	t.Cleanup(func() { _ = db.Close() })

	tokens := security.NewTokenService("test-secret", time.Hour)
	// A repo with no users: download must not depend on user lookups.
	h := UploadRoutes(&config.Config{UploadDir: dir}, db, tokens, &uploadUserRepo{})
	token, err := tokens.CreateForUser("alice")
	require.NoError(t, err)

	get := func(path, authHeader string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		if authHeader != "" {
			req.Header.Set("Authorization", authHeader)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}

	t.Run("query token", func(t *testing.T) {
		rec := get("/abc.txt?token="+token, "")
		require.Equal(t, http.StatusOK, rec.Code)
		require.Equal(t, "file body", rec.Body.String())
		require.Contains(t, rec.Header().Get("Content-Disposition"), "attachment")
		require.Contains(t, rec.Header().Get("Content-Disposition"), "report final.txt")
	})
	t.Run("bearer token", func(t *testing.T) {
		rec := get("/abc.txt", "Bearer "+token)
		require.Equal(t, http.StatusOK, rec.Code)
		require.Equal(t, "file body", rec.Body.String())
	})
	require.Equal(t, 2, updates, "read_count updated once per successful download")
	t.Run("no token", func(t *testing.T) {
		require.Equal(t, http.StatusUnauthorized, get("/abc.txt", "").Code)
	})
	t.Run("invalid query token", func(t *testing.T) {
		require.Equal(t, http.StatusUnauthorized, get("/abc.txt?token=bogus", "").Code)
	})
	t.Run("path traversal rejected", func(t *testing.T) {
		require.Equal(t, http.StatusNotFound, get("/..%2Fsecret?token="+token, "").Code)
	})
}

func readDirNames(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		names = append(names, e.Name())
	}
	return names, nil
}
