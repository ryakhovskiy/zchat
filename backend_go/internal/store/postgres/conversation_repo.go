package postgres

import (
	"context"
	"database/sql"
	"fmt"

	"backend_go/internal/domain"
)

type ConversationRepo struct {
	db *sql.DB
}

func NewConversationRepo(db *sql.DB) *ConversationRepo {
	return &ConversationRepo{db: db}
}

var _ domain.ConversationRepository = (*ConversationRepo)(nil)

func (r *ConversationRepo) Create(ctx context.Context, c *domain.Conversation, participantIDs []int64) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	if err := tx.QueryRowContext(ctx, `
		INSERT INTO conversations (name, is_group, created_at, updated_at)
		VALUES ($1, $2, NOW(), NOW())
		RETURNING id, created_at, updated_at
	`, c.Name, c.IsGroup).Scan(&c.ID, &c.CreatedAt, &c.UpdatedAt); err != nil {
		return fmt.Errorf("insert conversation: %w", err)
	}

	for _, uid := range participantIDs {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO conversation_participants (user_id, conversation_id, joined_at)
			VALUES ($1, $2, NOW())
			ON CONFLICT DO NOTHING
		`, uid, c.ID); err != nil {
			return fmt.Errorf("insert participant %d: %w", uid, err)
		}
	}

	return tx.Commit()
}

func (r *ConversationRepo) GetByID(ctx context.Context, id int64) (*domain.Conversation, error) {
	c := &domain.Conversation{}
	err := r.db.QueryRowContext(ctx, `
		SELECT id, name, is_group, created_at, updated_at
		FROM conversations WHERE id = $1
	`, id).Scan(&c.ID, &c.Name, &c.IsGroup, &c.CreatedAt, &c.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get conversation: %w", err)
	}
	return c, nil
}

func (r *ConversationRepo) ListForUser(ctx context.Context, userID int64) ([]*domain.Conversation, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT c.id, c.name, c.is_group, c.created_at, c.updated_at
		FROM conversations c
		JOIN conversation_participants cp ON cp.conversation_id = c.id
		WHERE cp.user_id = $1
		ORDER BY c.updated_at DESC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("list conversations: %w", err)
	}
	defer rows.Close()

	var res []*domain.Conversation
	for rows.Next() {
		c := &domain.Conversation{}
		if err := rows.Scan(&c.ID, &c.Name, &c.IsGroup, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan conversation: %w", err)
		}
		res = append(res, c)
	}
	return res, rows.Err()
}

func (r *ConversationRepo) MarkAsRead(ctx context.Context, conversationID, userID int64) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE conversation_participants
		SET last_read_at = NOW()
		WHERE conversation_id = $1 AND user_id = $2
	`, conversationID, userID)
	return err
}

func (r *ConversationRepo) GetUnreadCount(ctx context.Context, conversationID, userID int64) (int, error) {
	var count int
	err := r.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM messages m
		JOIN conversation_participants cp
		  ON cp.conversation_id = m.conversation_id AND cp.user_id = $2
		WHERE m.conversation_id = $1
		  AND m.sender_id != $2
		  AND m.is_read = FALSE
		  AND m.is_deleted = FALSE
		  AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)
	`, conversationID, userID).Scan(&count)
	return count, err
}

// FindExistingDirect finds a direct (non-group) conversation between exactly two users.
func (r *ConversationRepo) FindExistingDirect(ctx context.Context, participantIDs []int64) (*domain.Conversation, error) {
	if len(participantIDs) != 2 {
		return nil, nil
	}
	c := &domain.Conversation{}
	err := r.db.QueryRowContext(ctx, `
		SELECT c.id, c.name, c.is_group, c.created_at, c.updated_at
		FROM conversations c
		WHERE c.is_group = FALSE
		  AND (SELECT COUNT(*) FROM conversation_participants cp WHERE cp.conversation_id = c.id) = 2
		  AND EXISTS (SELECT 1 FROM conversation_participants cp WHERE cp.conversation_id = c.id AND cp.user_id = $1)
		  AND EXISTS (SELECT 1 FROM conversation_participants cp WHERE cp.conversation_id = c.id AND cp.user_id = $2)
		LIMIT 1
	`, participantIDs[0], participantIDs[1],
	).Scan(&c.ID, &c.Name, &c.IsGroup, &c.CreatedAt, &c.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("find existing direct: %w", err)
	}
	return c, nil
}

// FindExistingGroup finds a group conversation with exactly the given participant set.
func (r *ConversationRepo) FindExistingGroup(ctx context.Context, participantIDs []int64) (*domain.Conversation, error) {
	n := int64(len(participantIDs))
	// Pass IDs as a PostgreSQL array literal so we avoid N placeholders.
	// pgx/stdlib supports []int64 as $2::bigint[].
	c := &domain.Conversation{}
	err := r.db.QueryRowContext(ctx, `
		SELECT c.id, c.name, c.is_group, c.created_at, c.updated_at
		FROM conversations c
		WHERE c.is_group = TRUE
		  AND (SELECT COUNT(*) FROM conversation_participants cp WHERE cp.conversation_id = c.id) = $1
		  AND (SELECT COUNT(*) FROM conversation_participants cp
		       WHERE cp.conversation_id = c.id AND cp.user_id = ANY($2::bigint[])) = $1
		LIMIT 1
	`, n, participantIDs,
	).Scan(&c.ID, &c.Name, &c.IsGroup, &c.CreatedAt, &c.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("find existing group: %w", err)
	}
	return c, nil
}
