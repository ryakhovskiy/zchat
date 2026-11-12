package service_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"

	"backend/internal/domain"
	"backend/internal/security"
	"backend/internal/service"
)

// Mock mocks
type MockUserRepo struct {
	mock.Mock
}

func (m *MockUserRepo) Create(ctx context.Context, u *domain.User, maxUsers int) error {
	args := m.Called(ctx, u, maxUsers)
	return args.Error(0)
}

func (m *MockUserRepo) GetByID(ctx context.Context, id int64) (*domain.User, error) {
	args := m.Called(ctx, id)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*domain.User), args.Error(1)
}

func (m *MockUserRepo) GetByUsername(ctx context.Context, username string) (*domain.User, error) {
	args := m.Called(ctx, username)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*domain.User), args.Error(1)
}

func (m *MockUserRepo) GetByEmail(ctx context.Context, email string) (*domain.User, error) {
	args := m.Called(ctx, email)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*domain.User), args.Error(1)
}

func (m *MockUserRepo) ListActive(ctx context.Context, offset, limit int) ([]*domain.User, error) {
	return nil, nil // Not used in auth tests
}

func (m *MockUserRepo) ListOnline(ctx context.Context) ([]*domain.User, error) {
	return nil, nil
}

func (m *MockUserRepo) Update(ctx context.Context, u *domain.User) error {
	return nil
}

func (m *MockUserRepo) UpdatePassword(ctx context.Context, userID int64, hashedPassword string) error {
	args := m.Called(ctx, userID, hashedPassword)
	return args.Error(0)
}

func (m *MockUserRepo) SoftDelete(ctx context.Context, id int64) error {
	return nil
}

func (m *MockUserRepo) SetOnlineStatus(ctx context.Context, userID int64, isOnline bool) error {
	args := m.Called(ctx, userID, isOnline)
	return args.Error(0)
}

func (m *MockUserRepo) ResetAllOnlineStatus(ctx context.Context) error {
	return nil
}

func TestRegister(t *testing.T) {
	mockRepo := new(MockUserRepo)
	tokenSvc := security.NewTokenService("secret", time.Hour)
	hasher := security.NewPasswordHasher(10) // low cost for tests

	svc := service.NewAuthService(mockRepo, tokenSvc, hasher, time.Hour, 24*time.Hour, 10)

	t.Run("Success", func(t *testing.T) {
		input := service.RegisterInput{
			Username: "newuser",
			Password: "Password1!",
		}

		mockRepo.On("GetByUsername", mock.Anything, "newuser").Return(nil, domain.ErrNotFound)
		mockRepo.On("Create", mock.Anything, mock.MatchedBy(func(u *domain.User) bool {
			return u.Username == "newuser"
		}), 10).Return(nil)

		user, err := svc.Register(context.Background(), input)
		assert.NoError(t, err)
		assert.NotNil(t, user)
		assert.Equal(t, "newuser", user.Username)
	})

	t.Run("UsernameTaken", func(t *testing.T) {
		input := service.RegisterInput{
			Username: "existing",
			Password: "Password1!",
		}

		existing := &domain.User{Username: "existing"}
		mockRepo.On("GetByUsername", mock.Anything, "existing").Return(existing, nil)

		user, err := svc.Register(context.Background(), input)
		assert.Error(t, err)
		assert.Nil(t, user)
		assert.Equal(t, domain.ErrConflict, err)
	})
}

func TestRegisterUserLimitReached(t *testing.T) {
	for _, limit := range []int{10, 3} {
		t.Run(fmt.Sprintf("Limit%d", limit), func(t *testing.T) {
			repo := new(MockUserRepo)
			svc := service.NewAuthService(repo, security.NewTokenService("secret", time.Hour),
				security.NewPasswordHasher(10), time.Hour, 24*time.Hour, limit)
			repo.On("GetByUsername", mock.Anything, "newuser").Return(nil, domain.ErrNotFound).Once()
			repo.On("Create", mock.Anything, mock.AnythingOfType("*domain.User"), limit).
				Return(domain.ErrUserLimitReached).Once()

			user, err := svc.Register(context.Background(), service.RegisterInput{
				Username: "newuser", Password: "Password1!",
			})

			assert.ErrorIs(t, err, domain.ErrUserLimitReached)
			assert.Nil(t, user)
			repo.AssertNotCalled(t, "SetOnlineStatus", mock.Anything, mock.Anything, mock.Anything)
			repo.AssertExpectations(t)
		})
	}
}
