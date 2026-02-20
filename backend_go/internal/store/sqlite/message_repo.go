package sqlite

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

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
	query := `
		INSERT INTO messages (content, conversation_id, sender_id, created_at, file_path, file_type, fully_read_at, is_deleted)
		VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?)
	`
	res, err := r.db.ExecContext(ctx, query,
		m.Content,
		m.ConversationID,
		m.SenderID,
		m.FilePath,
		m.FileType,
		m.FullyReadAt,
		m.IsDeleted,
	)
	if err != nil {
		return fmt.Errorf("insert message: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return fmt.Errorf("last insert id: %w", err)
	}
	m.ID = id
	return nil
}

func (r *MessageRepo) ListForConversation(ctx context.Context, conversationID int64, limit int) ([]*domain.Message, error) {
	query := `
		SELECT id, content, conversation_id, sender_id, created_at, file_path, file_type, fully_read_at, is_deleted
		FROM messages
		WHERE conversation_id = ?
		ORDER BY created_at DESC
		LIMIT ?
	`
	rows, err := r.db.QueryContext(ctx, query, conversationID, limit)
	if err != nil {
		return nil, fmt.Errorf("list messages: %w", err)
	}
	defer rows.Close()

	var res []*domain.Message
	for rows.Next() {
		m := &domain.Message{}
		if err := rows.Scan(
			&m.ID,
			&m.Content,
			&m.ConversationID,
			&m.SenderID,
			&m.CreatedAt,
			&m.FilePath,
			&m.FileType,
			&m.FullyReadAt,
			&m.IsDeleted,
		); err != nil {
			return nil, fmt.Errorf("scan message: %w", err)
		}
		res = append(res, m)
	}
	return res, nil
}

func (r *MessageRepo) PruneOld(ctx context.Context, conversationID int64, keepLimit int) error {
	// Count messages
	var count int
	if err := r.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM messages WHERE conversation_id = ?
	`, conversationID).Scan(&count); err != nil {
		return fmt.Errorf("count messages: %w", err)
	}

	if count <= keepLimit {
		return nil
	}

	// Get IDs of messages to delete (oldest first)
	rows, err := r.db.QueryContext(ctx, `
		SELECT id FROM messages
		WHERE conversation_id = ?
		ORDER BY created_at ASC
		LIMIT ?
	`, conversationID, count-keepLimit)
	if err != nil {
		return fmt.Errorf("select old messages: %w", err)
	}
	defer rows.Close()

	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return fmt.Errorf("scan id: %w", err)
		}
		ids = append(ids, id)
	}

	if len(ids) == 0 {
		return nil
	}

	// Delete messages
	query := `DELETE FROM messages WHERE id IN (?` + strings.Repeat(",?", len(ids)-1) + `)`
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	if _, err := r.db.ExecContext(ctx, query, args...); err != nil {
		return fmt.Errorf("delete old messages: %w", err)
	}
	return nil
}

