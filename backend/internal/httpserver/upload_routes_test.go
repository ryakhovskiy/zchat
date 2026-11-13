package httpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
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

func TestUploadDownloadStillUsesTokenParam(t *testing.T) {
	h, _, _ := newUploadServer(t)
	// No token: 401 from the GET handler's own check (unchanged behavior).
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/x.txt", nil))
	require.Equal(t, http.StatusUnauthorized, rec.Code)
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
