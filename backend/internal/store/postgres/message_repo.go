package postgres

import (
	"context"
	"database/sql"
	"fmt"
	"strconv"
	"strings"

	"backend/internal/domain"
)

type MessageRepo struct {
	db *sql.DB
}

func NewMessageRepo(db *sql.DB) *MessageRepo {
	return &MessageRepo{db: db}
}

var _ domain.MessageRepository = (*MessageRepo)(nil)

func (r *MessageRepo) Create(ctx context.Context, m *domain.Message) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin message create tx: %w", err)
	}
	defer tx.Rollback()

	err = tx.QueryRowContext(ctx, `
		INSERT INTO messages
			(content, conversation_id, sender_id, created_at, file_path, file_type, fully_read_at, is_deleted, is_edited, is_read, reply_to_id)
		VALUES ($1, $2, $3, NOW(), $4, $5, $6, FALSE, FALSE, FALSE, $7)
		RETURNING id, created_at
	`, m.Content, m.ConversationID, m.SenderID,
		m.FilePath, m.FileType, m.FullyReadAt, m.ReplyToID,
	).Scan(&m.ID, &m.CreatedAt)

	if err != nil {
		return fmt.Errorf("insert message: %w", err)
	}

	for i := range m.Attachments {
		att := &m.Attachments[i]
		att.MessageID = m.ID
		err = tx.QueryRowContext(ctx, `
			INSERT INTO attachments
				(message_id, file_path, original_name, file_size, file_type, mime_type, read_count, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
			RETURNING id, created_at
		`, att.MessageID, att.FilePath, att.OriginalName, att.FileSize, att.FileType, att.MimeType, att.ReadCount,
		).Scan(&att.ID, &att.CreatedAt)
		if err != nil {
			return fmt.Errorf("insert attachment: %w", err)
		}
	}

	return tx.Commit()
}

func (r *MessageRepo) CreateAttachment(ctx context.Context, a *domain.Attachment) error {
	return r.db.QueryRowContext(ctx, `
		INSERT INTO attachments
			(message_id, file_path, original_name, file_size, file_type, mime_type, read_count, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
		RETURNING id, created_at
	`, a.MessageID, a.FilePath, a.OriginalName, a.FileSize, a.FileType, a.MimeType, a.ReadCount,
	).Scan(&a.ID, &a.CreatedAt)
}

func (r *MessageRepo) GetAttachment(ctx context.Context, id int64) (*domain.Attachment, error) {
	a := &domain.Attachment{}
	err := r.db.QueryRowContext(ctx, `
		SELECT id, message_id, file_path, original_name, file_size, file_type, mime_type, read_count, created_at
		FROM attachments WHERE id = $1
	`, id).Scan(
		&a.ID, &a.MessageID, &a.FilePath, &a.OriginalName,
		&a.FileSize, &a.FileType, &a.MimeType, &a.ReadCount, &a.CreatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get attachment: %w", err)
	}
	return a, nil
}

func (r *MessageRepo) GetByID(ctx context.Context, id int64) (*domain.Message, error) {
	m := &domain.Message{}
	err := r.db.QueryRowContext(ctx, `
		SELECT id, content, conversation_id, sender_id, created_at, file_path, file_type,
		       fully_read_at, is_deleted, is_edited, is_read, reply_to_id
		FROM messages WHERE id = $1
	`, id).Scan(
		&m.ID, &m.Content, &m.ConversationID, &m.SenderID, &m.CreatedAt,
		&m.FilePath, &m.FileType, &m.FullyReadAt, &m.IsDeleted, &m.IsEdited, &m.IsRead, &m.ReplyToID,
	)
	if err == sql.ErrNoRows {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get message: %w", err)
	}

	if err := r.populateAttachments(ctx, []*domain.Message{m}); err != nil {
		return nil, fmt.Errorf("populate attachments: %w", err)
	}
	if err := r.populateReactions(ctx, []*domain.Message{m}); err != nil {
		return nil, fmt.Errorf("populate reactions: %w", err)
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
		       fully_read_at, is_deleted, is_edited, is_read, reply_to_id
		FROM messages
		WHERE conversation_id = $1
		ORDER BY created_at DESC
		LIMIT $2
	`, conversationID, limit)
	if err != nil {
		return nil, fmt.Errorf("list messages: %w", err)
	}
	messages, err := r.scanMessages(rows)
	if err != nil {
		return nil, err
	}
	if err := r.populateAttachments(ctx, messages); err != nil {
		return nil, fmt.Errorf("populate attachments: %w", err)
	}
	if err := r.populateReactions(ctx, messages); err != nil {
		return nil, fmt.Errorf("populate reactions: %w", err)
	}
	return messages, nil
}

// ListForConversationForUser is like ListForConversation but excludes messages
// the given user has soft-deleted via "delete for me".
func (r *MessageRepo) ListForConversationForUser(ctx context.Context, conversationID, userID int64, limit int) ([]*domain.Message, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT m.id, m.content, m.conversation_id, m.sender_id, m.created_at,
		       m.file_path, m.file_type, m.fully_read_at, m.is_deleted, m.is_edited, m.is_read, m.reply_to_id
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
	messages, err := r.scanMessages(rows)
	if err != nil {
		return nil, err
	}
	if err := r.populateAttachments(ctx, messages); err != nil {
		return nil, fmt.Errorf("populate attachments: %w", err)
	}
	if err := r.populateReactions(ctx, messages); err != nil {
		return nil, fmt.Errorf("populate reactions: %w", err)
	}
	return messages, nil
}

// ListForConversationForUserBefore returns messages older than beforeID,
// excluding messages the user has soft-deleted.
func (r *MessageRepo) ListForConversationForUserBefore(ctx context.Context, conversationID, userID, beforeID int64, limit int) ([]*domain.Message, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT m.id, m.content, m.conversation_id, m.sender_id, m.created_at,
		       m.file_path, m.file_type, m.fully_read_at, m.is_deleted, m.is_edited, m.is_read, m.reply_to_id
		FROM messages m
		LEFT JOIN user_deleted_messages udm
		       ON udm.message_id = m.id AND udm.user_id = $2
		WHERE m.conversation_id = $1
		  AND udm.user_id IS NULL
		  AND m.id < $4
		ORDER BY m.created_at DESC
		LIMIT $3
	`, conversationID, userID, limit, beforeID)
	if err != nil {
		return nil, fmt.Errorf("list messages before: %w", err)
	}
	messages, err := r.scanMessages(rows)
	if err != nil {
		return nil, err
	}
	if err := r.populateAttachments(ctx, messages); err != nil {
		return nil, fmt.Errorf("populate attachments: %w", err)
	}
	if err := r.populateReactions(ctx, messages); err != nil {
		return nil, fmt.Errorf("populate reactions: %w", err)
	}
	return messages, nil
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
			&m.FilePath, &m.FileType, &m.FullyReadAt, &m.IsDeleted, &m.IsEdited, &m.IsRead, &m.ReplyToID,
		); err != nil {
			return nil, fmt.Errorf("scan message: %w", err)
		}
		res = append(res, m)
	}
	return res, rows.Err()
}

func (r *MessageRepo) populateAttachments(ctx context.Context, messages []*domain.Message) error {
	if len(messages) == 0 {
		return nil
	}

	msgIDs := make([]int64, len(messages))
	msgMap := make(map[int64]*domain.Message)
	for i, m := range messages {
		msgIDs[i] = m.ID
		msgMap[m.ID] = m
		m.Attachments = []domain.Attachment{}
	}

	args := make([]interface{}, len(msgIDs))
	placeholders := make([]string, len(msgIDs))
	for i, id := range msgIDs {
		args[i] = id
		placeholders[i] = "$" + strconv.Itoa(i+1)
	}

	query := fmt.Sprintf(`
		SELECT id, message_id, file_path, original_name, file_size, file_type, mime_type, read_count, created_at
		FROM attachments
		WHERE message_id IN (%s)
		ORDER BY created_at ASC
	`, strings.Join(placeholders, ","))

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("query attachments: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var a domain.Attachment
		if err := rows.Scan(
			&a.ID, &a.MessageID, &a.FilePath, &a.OriginalName,
			&a.FileSize, &a.FileType, &a.MimeType, &a.ReadCount, &a.CreatedAt,
		); err != nil {
			return fmt.Errorf("scan attachment: %w", err)
		}
		if m, ok := msgMap[a.MessageID]; ok {
			m.Attachments = append(m.Attachments, a)
		}
	}

	return rows.Err()
}

func (r *MessageRepo) populateReactions(ctx context.Context, messages []*domain.Message) error {
	if len(messages) == 0 {
		return nil
	}

	msgIDs := make([]int64, len(messages))
	msgMap := make(map[int64]*domain.Message)
	for i, m := range messages {
		msgIDs[i] = m.ID
		msgMap[m.ID] = m
		m.Reactions = []domain.ReactionSummary{}
	}

	args := make([]interface{}, len(msgIDs))
	placeholders := make([]string, len(msgIDs))
	for i, id := range msgIDs {
		args[i] = id
		placeholders[i] = "$" + strconv.Itoa(i+1)
	}

	query := fmt.Sprintf(`
		SELECT message_id, emoji, user_id
		FROM message_reactions
		WHERE message_id IN (%s)
		ORDER BY message_id, created_at ASC
	`, strings.Join(placeholders, ","))

	rrows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("query reactions: %w", err)
	}
	defer rrows.Close()

	type emojiKey struct {
		msgID int64
		emoji string
	}
	emojiUsers := make(map[emojiKey][]int64)
	msgEmojiOrder := make(map[int64][]string)

	for rrows.Next() {
		var msgID, userID int64
		var emoji string
		if err := rrows.Scan(&msgID, &emoji, &userID); err != nil {
			return fmt.Errorf("scan reaction row: %w", err)
		}
		k := emojiKey{msgID: msgID, emoji: emoji}
		if _, ok := emojiUsers[k]; !ok {
			msgEmojiOrder[msgID] = append(msgEmojiOrder[msgID], emoji)
		}
		emojiUsers[k] = append(emojiUsers[k], userID)
	}
	if err := rrows.Err(); err != nil {
		return err
	}

	for msgID, emojis := range msgEmojiOrder {
		m, ok := msgMap[msgID]
		if !ok {
			continue
		}
		seen := make(map[string]bool)
		for _, e := range emojis {
			if seen[e] {
				continue
			}
			seen[e] = true
			k := emojiKey{msgID: msgID, emoji: e}
			uids := emojiUsers[k]
			m.Reactions = append(m.Reactions, domain.ReactionSummary{
				Emoji:   e,
				Count:   len(uids),
				UserIDs: uids,
			})
		}
	}
	return nil
}
