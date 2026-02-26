package service

import (
	"context"
	"fmt"

	"backend_go/internal/domain"
)

// UserService provides user-related operations.
type UserService struct {
	users domain.UserRepository
}

func NewUserService(users domain.UserRepository) *UserService {
	return &UserService{users: users}
}

func (s *UserService) GetByID(ctx context.Context, id int64) (*domain.User, error) {
	return s.users.GetByID(ctx, id)
}

func (s *UserService) ListActive(ctx context.Context, offset, limit int) ([]*domain.User, error) {
	return s.users.ListActive(ctx, offset, limit)
}

func (s *UserService) ListOnline(ctx context.Context) ([]*domain.User, error) {
	return s.users.ListOnline(ctx)
}

func (s *UserService) SoftDelete(ctx context.Context, id int64) error {
	return s.users.SoftDelete(ctx, id)
}

func (s *UserService) SetOnlineStatus(ctx context.Context, id int64, isOnline bool) error {
	return s.users.SetOnlineStatus(ctx, id, isOnline)
}

// UserStats is a simplified version of the Python service stats.
type UserStats struct {
	UserID            int64  `json:"user_id"`
	Username          string `json:"username"`
	ConversationCount int    `json:"conversation_count"`
	MessageCount      int    `json:"message_count"`
}

// GetStats would require additional queries; left as a placeholder.
func (s *UserService) GetStats(ctx context.Context, user *domain.User) (*UserStats, error) {
	if user == nil {
		return nil, fmt.Errorf("user is nil")
	}
	// For now, return minimal stats; can be expanded with additional queries.
	return &UserStats{
		UserID:   user.ID,
		Username: user.Username,
	}, nil
}
