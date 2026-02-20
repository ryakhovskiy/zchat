package service

import (
	"context"
	"errors"
	"fmt"

	"backend_go/internal/domain"
	"backend_go/internal/security"
)

// AuthService handles registration, login, and logout.
type AuthService struct {
	users  domain.UserRepository
	tokens *security.TokenService
	hash   *security.PasswordHasher
}

func NewAuthService(users domain.UserRepository, tokens *security.TokenService, hash *security.PasswordHasher) *AuthService {
	return &AuthService{
		users:  users,
		tokens: tokens,
		hash:   hash,
	}
}

type RegisterInput struct {
	Username string
	Email    *string
	Password string
}

type LoginInput struct {
	Username string
	Password string
}

type TokenResponse struct {
	AccessToken string
	TokenType   string
	User        *domain.User
}

func (s *AuthService) Register(ctx context.Context, in RegisterInput) (*domain.User, error) {
	if in.Username == "" || in.Password == "" {
		return nil, errors.New("username and password are required")
	}

	// Check username uniqueness
	if existing, err := s.users.GetByUsername(ctx, in.Username); err != nil {
		return nil, fmt.Errorf("check username: %w", err)
	} else if existing != nil {
		return nil, errors.New("username already registered")
	}

	// Check email uniqueness (if provided)
	if in.Email != nil && *in.Email != "" {
		if existing, err := s.users.GetByEmail(ctx, *in.Email); err != nil {
			return nil, fmt.Errorf("check email: %w", err)
		} else if existing != nil {
			return nil, errors.New("email already registered")
		}
	}

	hashed, err := s.hash.Hash(in.Password)
	if err != nil {
		return nil, fmt.Errorf("hash password: %w", err)
	}

	user := &domain.User{
		Username:       in.Username,
		Email:          in.Email,
		HashedPassword: hashed,
		IsActive:       true,
		IsOnline:       false,
	}

	if err := s.users.Create(ctx, user); err != nil {
		return nil, err
	}
	return user, nil
}

func (s *AuthService) Login(ctx context.Context, in LoginInput) (*TokenResponse, error) {
	user, err := s.users.GetByUsername(ctx, in.Username)
	if err != nil {
		return nil, fmt.Errorf("get user: %w", err)
	}
	if user == nil {
		return nil, errors.New("incorrect username or password")
	}
	if !user.IsActive {
		return nil, errors.New("user account is inactive")
	}

	if err := s.hash.Verify(in.Password, user.HashedPassword); err != nil {
		return nil, errors.New("incorrect username or password")
	}

	// Update online status
	if err := s.users.SetOnlineStatus(ctx, user.ID, true); err != nil {
		return nil, fmt.Errorf("set online: %w", err)
	}

	token, err := s.tokens.CreateForUser(user.Username)
	if err != nil {
		return nil, fmt.Errorf("create token: %w", err)
	}

	return &TokenResponse{
		AccessToken: token,
		TokenType:   "bearer",
		User:        user,
	}, nil
}

func (s *AuthService) Logout(ctx context.Context, userID int64) error {
	return s.users.SetOnlineStatus(ctx, userID, false)
}

