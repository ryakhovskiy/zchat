package httpserver

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"backend/internal/domain"
	"backend/internal/security"
	"backend/internal/service"

	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

type registrationRepo struct {
	domain.UserRepository
	mock.Mock
}

func (m *registrationRepo) GetByUsername(ctx context.Context, username string) (*domain.User, error) {
	args := m.Called(ctx, username)
	return nil, args.Error(1)
}

func (m *registrationRepo) Create(ctx context.Context, user *domain.User, limit int) error {
	return m.Called(ctx, user, limit).Error(0)
}

func (m *registrationRepo) SetOnlineStatus(ctx context.Context, id int64, online bool) error {
	return m.Called(ctx, id, online).Error(0)
}

func TestHandleRegisterUserLimitReached(t *testing.T) {
	repo := new(registrationRepo)
	repo.On("GetByUsername", mock.Anything, "newuser").Return(nil, domain.ErrNotFound).Once()
	repo.On("Create", mock.Anything, mock.AnythingOfType("*domain.User"), 10).
		Return(domain.ErrUserLimitReached).Once()
	authSvc := service.NewAuthService(repo, security.NewTokenService("secret", time.Hour),
		security.NewPasswordHasher(10), time.Hour, 24*time.Hour, 10)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/register",
		strings.NewReader(`{"username":"newuser","password":"Password1!"}`))
	resp := httptest.NewRecorder()

	handleRegister(authSvc, service.NewUserService(repo))(resp, req)

	require.Equal(t, http.StatusForbidden, resp.Code)
	var body map[string]string
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &body))
	require.Equal(t, map[string]string{"error": domain.ErrUserLimitReached.Error()}, body)
	repo.AssertNotCalled(t, "SetOnlineStatus", mock.Anything, mock.Anything, mock.Anything)
	repo.AssertExpectations(t)
}
