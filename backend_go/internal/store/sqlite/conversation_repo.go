package sqlite

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

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

	res, err := tx.ExecContext(ctx, `
		INSERT INTO conversations (name, is_group, created_at, updated_at)
		VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
	`, c.Name, c.IsGroup)
	if err != nil {
		return fmt.Errorf("insert conversation: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return fmt.Errorf("last insert id: %w", err)
	}
	c.ID = id

	for _, uid := range participantIDs {
		if _, err := tx.ExecContext(ctx, `
			INSERT OR IGNORE INTO conversation_participants (user_id, conversation_id, joined_at)
			VALUES (?, ?, CURRENT_TIMESTAMP)
		`, uid, id); err != nil {
			return fmt.Errorf("insert participant: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	return nil
}

func (r *ConversationRepo) GetByID(ctx context.Context, id int64) (*domain.Conversation, error) {
	query := `
		SELECT id, name, is_group, created_at, updated_at
		FROM conversations
		WHERE id = ?
	`
	c := &domain.Conversation{}
	err := r.db.QueryRowContext(ctx, query, id).Scan(
		&c.ID,
		&c.Name,
		&c.IsGroup,
		&c.CreatedAt,
		&c.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get conversation: %w", err)
	}
	return c, nil
}

func (r *ConversationRepo) ListForUser(ctx context.Context, userID int64) ([]*domain.Conversation, error) {
	query := `
		SELECT c.id, c.name, c.is_group, c.created_at, c.updated_at
		FROM conversations c
		JOIN conversation_participants cp ON cp.conversation_id = c.id
		WHERE cp.user_id = ?
		ORDER BY c.updated_at DESC
	`
	rows, err := r.db.QueryContext(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("list conversations: %w", err)
	}
	defer rows.Close()

	var res []*domain.Conversation
	for rows.Next() {
		c := &domain.Conversation{}
		if err := rows.Scan(
			&c.ID,
			&c.Name,
			&c.IsGroup,
			&c.CreatedAt,
			&c.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan conversation: %w", err)
		}
		res = append(res, c)
	}
	return res, nil
}

func (r *ConversationRepo) MarkAsRead(ctx context.Context, conversationID, userID int64) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE conversation_participants
		SET last_read_at = CURRENT_TIMESTAMP
		WHERE conversation_id = ? AND user_id = ?
	`, conversationID, userID)
	if err != nil {
		return fmt.Errorf("mark as read: %w", err)
	}
	return nil
}

func (r *ConversationRepo) GetUnreadCount(ctx context.Context, conversationID, userID int64) (int, error) {
	// Get last_read_at
	var lastRead sql.NullTime
	err := r.db.QueryRowContext(ctx, `
		SELECT last_read_at
		FROM conversation_participants
		WHERE conversation_id = ? AND user_id = ?
	`, conversationID, userID).Scan(&lastRead)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("get last_read_at: %w", err)
	}

	query := `
		SELECT COUNT(*)
		FROM messages
		WHERE conversation_id = ? AND sender_id <> ?
	`
	var args []any
	args = append(args, conversationID, userID)
	if lastRead.Valid {
		query += " AND created_at > ?"
		args = append(args, lastRead.Time)
	}

	var count int
	if err := r.db.QueryRowContext(ctx, query, args...).Scan(&count); err != nil {
		return 0, fmt.Errorf("count unread: %w", err)
	}
	return count, nil
}

func (r *ConversationRepo) FindExistingDirect(ctx context.Context, participantIDs []int64) (*domain.Conversation, error) {
	if len(participantIDs) != 2 {
		return nil, nil
	}
	// Find conversations that both users participate in and that are not group chats.
	query := `
		SELECT c.id, c.name, c.is_group, c.created_at, c.updated_at
		FROM conversations c
		JOIN conversation_participants cp1 ON cp1.conversation_id = c.id AND cp1.user_id = ?
		JOIN conversation_participants cp2 ON cp2.conversation_id = c.id AND cp2.user_id = ?
		WHERE c.is_group = 0
		LIMIT 1
	`
	c := &domain.Conversation{}
	err := r.db.QueryRowContext(ctx, query, participantIDs[0], participantIDs[1]).Scan(
		&c.ID,
		&c.Name,
		&c.IsGroup,
		&c.CreatedAt,
		&c.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("find direct conversation: %w", err)
	}
	return c, nil
}

func (r *ConversationRepo) FindExistingGroup(ctx context.Context, participantIDs []int64) (*domain.Conversation, error) {
	if len(participantIDs) < 2 {
		return nil, nil
	}
	// This query finds group conversations where all specified participants exist.
	// It does not strictly enforce that there are no extra participants, but is
	// sufficient for most use cases.
	query := `
		SELECT c.id, c.name, c.is_group, c.created_at, c.updated_at
		FROM conversations c
		WHERE c.is_group = 1
		AND NOT EXISTS (
			SELECT 1 FROM conversation_participants cp
			WHERE cp.conversation_id = c.id AND cp.user_id NOT IN (%s)
		)
		LIMIT 1
	`
	// Build placeholder list for IN clause.
	placeholders := strings.Repeat("?,", len(participantIDs))
	placeholders = strings.TrimRight(placeholders, ",")
	args := make([]any, 0, len(participantIDs))
	for i, id := range participantIDs {
		if i > 0 {
			placeholders += ","
		}
		placeholders += "?"
		args = append(args, id)
	}
	q := fmt.Sprintf(query, placeholders)

	c := &domain.Conversation{}
	err := r.db.QueryRowContext(ctx, q, args...).Scan(
		&c.ID,
		&c.Name,
		&c.IsGroup,
		&c.CreatedAt,
		&c.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("find group conversation: %w", err)
	}
	return c, nil
}
