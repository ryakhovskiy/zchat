package postgres

import (
	"context"
	"database/sql"
	"fmt"
	"strconv"
	"strings"

	"backend/internal/domain"
)

type ReactionRepo struct {
	db *sql.DB
}

func NewReactionRepo(db *sql.DB) *ReactionRepo {
	return &ReactionRepo{db: db}
}

var _ domain.MessageReactionRepository = (*ReactionRepo)(nil)

// Toggle adds the reaction if it doesn't exist, or removes it if it does.
func (r *ReactionRepo) Toggle(ctx context.Context, userID, messageID int64, emoji string) error {
	var exists bool
	err := r.db.QueryRowContext(ctx, `
		SELECT EXISTS(SELECT 1 FROM message_reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3)
	`, messageID, userID, emoji).Scan(&exists)
	if err != nil {
		return fmt.Errorf("check reaction exists: %w", err)
	}
	if exists {
		_, err = r.db.ExecContext(ctx, `
			DELETE FROM message_reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3
		`, messageID, userID, emoji)
		if err != nil {
			return fmt.Errorf("delete reaction: %w", err)
		}
	} else {
		_, err = r.db.ExecContext(ctx, `
			INSERT INTO message_reactions (message_id, user_id, emoji)
			VALUES ($1, $2, $3)
			ON CONFLICT (message_id, user_id, emoji) DO NOTHING
		`, messageID, userID, emoji)
		if err != nil {
			return fmt.Errorf("insert reaction: %w", err)
		}
	}
	return nil
}

// GetSummaryByMessages fetches aggregated reactions for the given message IDs.
func (r *ReactionRepo) GetSummaryByMessages(ctx context.Context, messageIDs []int64) (map[int64][]domain.ReactionSummary, error) {
	if len(messageIDs) == 0 {
		return map[int64][]domain.ReactionSummary{}, nil
	}

	args := make([]interface{}, len(messageIDs))
	placeholders := make([]string, len(messageIDs))
	for i, id := range messageIDs {
		args[i] = id
		placeholders[i] = "$" + strconv.Itoa(i+1)
	}

	query := fmt.Sprintf(`
		SELECT message_id, emoji, user_id
		FROM message_reactions
		WHERE message_id IN (%s)
		ORDER BY message_id, created_at ASC
	`, strings.Join(placeholders, ","))

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query reactions: %w", err)
	}
	defer rows.Close()

	type emojiKey struct {
		msgID int64
		emoji string
	}
	emojiUsers := make(map[emojiKey][]int64)
	// Preserve insertion order of emojis per message
	msgEmojiOrder := make(map[int64][]string)

	for rows.Next() {
		var msgID, userID int64
		var emoji string
		if err := rows.Scan(&msgID, &emoji, &userID); err != nil {
			return nil, fmt.Errorf("scan reaction: %w", err)
		}
		k := emojiKey{msgID: msgID, emoji: emoji}
		if _, ok := emojiUsers[k]; !ok {
			msgEmojiOrder[msgID] = append(msgEmojiOrder[msgID], emoji)
		}
		emojiUsers[k] = append(emojiUsers[k], userID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	result := make(map[int64][]domain.ReactionSummary, len(messageIDs))
	for msgID, emojis := range msgEmojiOrder {
		seen := make(map[string]bool)
		for _, emoji := range emojis {
			if seen[emoji] {
				continue
			}
			seen[emoji] = true
			k := emojiKey{msgID: msgID, emoji: emoji}
			uids := emojiUsers[k]
			result[msgID] = append(result[msgID], domain.ReactionSummary{
				Emoji:   emoji,
				Count:   len(uids),
				UserIDs: uids,
			})
		}
	}
	return result, nil
}
