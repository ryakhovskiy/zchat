package postgres

import (
	"context"
	"database/sql"
	"fmt"

	"backend_go/internal/domain"
)

type MessageRepo struct {
	db *sql.DB
}

func NewMessageRepo(db *sql.DB) *MessageRepo {
	return &MessageRepo{db: db}
}

var _ domain.MessageRepository = (*MessageRepo)(nil)

func (r *MessageRepo) Create(ctx context.Context, m *domain.Message) error {
	return r.db.QueryRowContext(ctx, `
		INSERT INTO messages
			(content, conversation_id, sender_id, created_at, file_path, file_type, fully_read_at, is_deleted, is_edited, is_read)
		VALUES ($1, $2, $3, NOW(), $4, $5, $6, FALSE, FALSE, FALSE)
		RETURNING id, created_at
	`, m.Content, m.ConversationID, m.SenderID,
		m.FilePath, m.FileType, m.FullyReadAt,
	).Scan(&m.ID, &m.CreatedAt)
}

func (r *MessageRepo) GetByID(ctx context.Context, id int64) (*domain.Message, error) {
	m := &domain.Message{}
	err := r.db.QueryRowContext(ctx, `
		SELECT id, content, conversation_id, sender_id, created_at, file_path, file_type,
		       fully_read_at, is_deleted, is_edited, is_read
		FROM messages WHERE id = $1
	`, id).Scan(
		&m.ID, &m.Content, &m.ConversationID, &m.SenderID, &m.CreatedAt,
		&m.FilePath, &m.FileType, &m.FullyReadAt, &m.IsDeleted, &m.IsEdited, &m.IsRead,
	)
	if err == sql.ErrNoRows {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get message: %w", err)
	}
	return m, nil
}

func (r *MessageRepo) Update(ctx context.Context, m *domain.Message) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE messages SET content=$1, is_edited=$2 WHERE id=$3
	`, m.Content, m.IsEdited, m.ID)
	return err
}

func (r *MessageRepo) SoftDeleteForEveryone(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx, `UPDATE messages SET is_deleted=TRUE WHERE id=$1`, id)
	return err
}

func (r *MessageRepo) ListForConversation(ctx context.Context, conversationID int64, limit int) ([]*domain.Message, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT id, content, conversation_id, sender_id, created_at, file_path, file_type,
		       fully_read_at, is_deleted, is_edited, is_read
		FROM messages
		WHERE conversation_id = $1
		ORDER BY created_at DESC
		LIMIT $2
	`, conversationID, limit)
	if err != nil {
		return nil, fmt.Errorf("list messages: %w", err)
	}
	return r.scanMessages(rows)
}

// ListForConversationForUser is like ListForConversation but excludes messages
// the given user has soft-deleted via "delete for me".
func (r *MessageRepo) ListForConversationForUser(ctx context.Context, conversationID, userID int64, limit int) ([]*domain.Message, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT m.id, m.content, m.conversation_id, m.sender_id, m.created_at,
		       m.file_path, m.file_type, m.fully_read_at, m.is_deleted, m.is_edited, m.is_read
		FROM messages m
		LEFT JOIN user_deleted_messages udm
		       ON udm.message_id = m.id AND udm.user_id = $2
		WHERE m.conversation_id = $1
		  AND udm.user_id IS NULL
		ORDER BY m.created_at DESC
		LIMIT $3
	`, conversationID, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("list messages for user: %w", err)
	}
	return r.scanMessages(rows)
}

func (r *MessageRepo) MarkAllReadInConversation(ctx context.Context, conversationID, senderExcludeID int64) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE messages SET is_read=TRUE
		WHERE conversation_id=$1 AND sender_id!=$2 AND is_read=FALSE AND is_deleted=FALSE
	`, conversationID, senderExcludeID)
	return err
}

func (r *MessageRepo) PruneOld(ctx context.Context, conversationID int64, keepLimit int) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin prune tx: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `
		DELETE FROM user_deleted_messages udm
		USING messages m
		WHERE udm.message_id = m.id
		  AND m.conversation_id = $1
		  AND m.id NOT IN (
			  SELECT id FROM messages
			  WHERE conversation_id = $1
			  ORDER BY created_at DESC
			  LIMIT $2
		  )
	`, conversationID, keepLimit); err != nil {
		return fmt.Errorf("delete dependent user_deleted_messages: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `
		DELETE FROM messages
		WHERE conversation_id = $1
		  AND id NOT IN (
			  SELECT id FROM messages
			  WHERE conversation_id = $1
			  ORDER BY created_at DESC
			  LIMIT $2
		  )
	`, conversationID, keepLimit); err != nil {
		return fmt.Errorf("delete old messages: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit prune tx: %w", err)
	}

	return nil
}

// ── helpers ──────────────────────────────────────────────────────────────────

func (r *MessageRepo) scanMessages(rows *sql.Rows) ([]*domain.Message, error) {
	defer rows.Close()
	var res []*domain.Message
	for rows.Next() {
		m := &domain.Message{}
		if err := rows.Scan(
			&m.ID, &m.Content, &m.ConversationID, &m.SenderID, &m.CreatedAt,
			&m.FilePath, &m.FileType, &m.FullyReadAt, &m.IsDeleted, &m.IsEdited, &m.IsRead,
		); err != nil {
			return nil, fmt.Errorf("scan message: %w", err)
		}
		res = append(res, m)
	}
	return res, rows.Err()
}
