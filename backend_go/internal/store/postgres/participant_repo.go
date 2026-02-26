package postgres

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
	rows, err := r.db.QueryContext(ctx, `
		SELECT u.id, u.username, u.email, u.hashed_password, u.is_active, u.is_online, u.created_at, u.last_seen
		FROM users u
		JOIN conversation_participants cp ON cp.user_id = u.id
		WHERE cp.conversation_id = $1
		ORDER BY u.username ASC
	`, conversationID)
	if err != nil {
		return nil, fmt.Errorf("list participants: %w", err)
	}
	defer rows.Close()

	repo := &UserRepo{db: r.db}
	return repo.scanUsers(rows)
}

func (r *ParticipantRepo) IsParticipant(ctx context.Context, conversationID, userID int64) (bool, error) {
	var exists bool
	err := r.db.QueryRowContext(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM conversation_participants
			WHERE conversation_id = $1 AND user_id = $2
		)
	`, conversationID, userID).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("check participant: %w", err)
	}
	return exists, nil
}

// UserDeletedMessageRepo implements domain.UserDeletedMessageRepository.
type UserDeletedMessageRepo struct {
	db *sql.DB
}

func NewUserDeletedMessageRepo(db *sql.DB) *UserDeletedMessageRepo {
	return &UserDeletedMessageRepo{db: db}
}

var _ domain.UserDeletedMessageRepository = (*UserDeletedMessageRepo)(nil)

func (r *UserDeletedMessageRepo) Create(ctx context.Context, userID, messageID int64) error {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO user_deleted_messages (user_id, message_id, deleted_at)
		VALUES ($1, $2, NOW())
		ON CONFLICT DO NOTHING
	`, userID, messageID)
	if err != nil {
		return fmt.Errorf("insert user_deleted_message: %w", err)
	}
	return nil
}

// ListConversationParticipantIDs returns just the user IDs in a conversation
// (useful for WS broadcasts without loading full User structs).
func ListConversationParticipantIDs(ctx context.Context, db *sql.DB, conversationID int64) ([]int64, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT user_id FROM conversation_participants WHERE conversation_id = $1
	`, conversationID)
	if err != nil {
		return nil, fmt.Errorf("list participant ids: %w", err)
	}
	defer rows.Close()
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
