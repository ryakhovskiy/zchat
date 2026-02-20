package service

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode"

	"backend_go/internal/domain"
	"backend_go/internal/security"
)

var (
	usernameRe = regexp.MustCompile(`^[a-z0-9_-]+$`)
	specialRe  = regexp.MustCompile(`[!@#$%^&*()\,\.?":{}|<>]`)
)

// AuthService handles registration, login, and logout.
type AuthService struct {
	users         domain.UserRepository
	tokens        *security.TokenService
	hash          *security.PasswordHasher
	defaultTTL    time.Duration
	rememberMeTTL time.Duration
}

func NewAuthService(
	users domain.UserRepository,
	tokens *security.TokenService,
	hash *security.PasswordHasher,
	defaultTTL time.Duration,
	rememberMeTTL time.Duration,
) *AuthService {
	return &AuthService{
		users:         users,
		tokens:        tokens,
		hash:          hash,
		defaultTTL:    defaultTTL,
		rememberMeTTL: rememberMeTTL,
	}
}

type RegisterInput struct {
	Username string
	Email    *string
	Password string
}

type LoginInput struct {
	Username   string
	Password   string
	RememberMe bool
}

type TokenResponse struct {
	AccessToken string
	TokenType   string
	User        *domain.User
}

func validateUsername(username string) error {
	username = strings.ToLower(username)
	if len(username) < 3 || len(username) > 50 {
		return errors.New("username must be 3–50 characters")
	}
	if !usernameRe.MatchString(username) {
		return errors.New("username may only contain letters, digits, underscores and hyphens")
	}
	return nil
}

func validatePassword(password string) error {
	if len(password) < 10 {
		return errors.New("password must be at least 10 characters")
	}
	var hasUpper, hasLower, hasDigit bool
	for _, ch := range password {
		switch {
		case unicode.IsUpper(ch):
			hasUpper = true
		case unicode.IsLower(ch):
			hasLower = true
		case unicode.IsDigit(ch):
			hasDigit = true
		}
	}
	if !hasUpper {
		return errors.New("password must contain at least one uppercase letter")
	}
	if !hasLower {
		return errors.New("password must contain at least one lowercase letter")
	}
	if !hasDigit {
		return errors.New("password must contain at least one digit")
	}
	if !specialRe.MatchString(password) {
		return errors.New(`password must contain at least one special character (!@#$%^&*()\,\.?":{}|<>)`)
	}
	return nil
}

func (s *AuthService) Register(ctx context.Context, in RegisterInput) (*domain.User, error) {
	// Normalise and validate
	in.Username = strings.ToLower(strings.TrimSpace(in.Username))
	if err := validateUsername(in.Username); err != nil {
		return nil, err
	}
	if err := validatePassword(in.Password); err != nil {
		return nil, err
	}

	if existing, err := s.users.GetByUsername(ctx, in.Username); err != nil {
		return nil, fmt.Errorf("check username: %w", err)
	} else if existing != nil {
		return nil, errors.New("username already registered")
	}

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
	user, err := s.users.GetByUsername(ctx, strings.ToLower(in.Username))
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
	if err := s.users.SetOnlineStatus(ctx, user.ID, true); err != nil {
		return nil, fmt.Errorf("set online: %w", err)
	}

	ttl := s.defaultTTL
	if in.RememberMe {
		ttl = s.rememberMeTTL
	}
	token, err := s.tokens.CreateWithTTL(user.Username, ttl)
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
