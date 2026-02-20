package sqlite

import (
	"context"
	"database/sql"
	"fmt"

	"backend_go/internal/domain"
)

type ParticipantRepo struct {
	db *sql.DB
}

func NewParticipantRepo(db *sql.DB) *ParticipantRepo {
	return &ParticipantRepo{db: db}
}

var _ domain.ParticipantRepository = (*ParticipantRepo)(nil)

func (r *ParticipantRepo) ListParticipants(ctx context.Context, conversationID int64) ([]*domain.User, error) {
	query := `
		SELECT u.id, u.username, u.email, u.hashed_password, u.is_active, u.is_online, u.created_at, u.last_seen
		FROM users u
		JOIN conversation_participants cp ON cp.user_id = u.id
		WHERE cp.conversation_id = ?
		ORDER BY u.username ASC
	`
	rows, err := r.db.QueryContext(ctx, query, conversationID)
	if err != nil {
		return nil, fmt.Errorf("list participants: %w", err)
	}
	defer rows.Close()

	var users []*domain.User
	for rows.Next() {
		u := &domain.User{}
		if err := rows.Scan(
			&u.ID,
			&u.Username,
			&u.Email,
			&u.HashedPassword,
			&u.IsActive,
			&u.IsOnline,
			&u.CreatedAt,
			&u.LastSeen,
		); err != nil {
			return nil, fmt.Errorf("scan participant: %w", err)
		}
		users = append(users, u)
	}
	return users, nil
}

func (r *ParticipantRepo) IsParticipant(ctx context.Context, conversationID, userID int64) (bool, error) {
	var exists int
	err := r.db.QueryRowContext(ctx, `
		SELECT 1
		FROM conversation_participants
		WHERE conversation_id = ? AND user_id = ?
	`, conversationID, userID).Scan(&exists)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("is participant: %w", err)
	}
	return true, nil
}

