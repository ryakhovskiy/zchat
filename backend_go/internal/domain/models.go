package domain

import "time"

// User represents an application user.
type User struct {
	ID             int64     `db:"id" json:"id"`
	Username       string    `db:"username" json:"username"`
	Email          *string   `db:"email" json:"email,omitempty"`
	HashedPassword string    `db:"hashed_password" json:"-"`
	IsActive       bool      `db:"is_active" json:"is_active"`
	IsOnline       bool      `db:"is_online" json:"is_online"`
	CreatedAt      time.Time `db:"created_at" json:"created_at"`
	LastSeen       time.Time `db:"last_seen" json:"last_seen"`
}

// Conversation represents a chat conversation (direct or group).
type Conversation struct {
	ID        int64     `db:"id" json:"id"`
	Name      *string   `db:"name" json:"name,omitempty"`
	IsGroup   bool      `db:"is_group" json:"is_group"`
	CreatedAt time.Time `db:"created_at" json:"created_at"`
	UpdatedAt time.Time `db:"updated_at" json:"updated_at"`
}

// ConversationParticipant represents the membership of a user in a conversation.
type ConversationParticipant struct {
	UserID         int64      `db:"user_id"`
	ConversationID int64      `db:"conversation_id"`
	LastReadAt     *time.Time `db:"last_read_at"`
	JoinedAt       *time.Time `db:"joined_at"`
}

// Message represents a single chat message.
type Message struct {
	ID             int64      `db:"id"`
	Content        string     `db:"content"` // encrypted at rest
	ConversationID int64      `db:"conversation_id"`
	SenderID       int64      `db:"sender_id"`
	CreatedAt      time.Time  `db:"created_at"`
	FilePath       *string    `db:"file_path"`
	FileType       *string    `db:"file_type"`
	FullyReadAt    *time.Time `db:"fully_read_at"`
	IsDeleted      bool       `db:"is_deleted"`
	IsEdited       bool       `db:"is_edited"`
	IsRead         bool       `db:"is_read"`
}

// UserDeletedMessage tracks per-user "delete for me" deletions.
type UserDeletedMessage struct {
	UserID    int64     `db:"user_id"`
	MessageID int64     `db:"message_id"`
	DeletedAt time.Time `db:"deleted_at"`
}

// ConversationResponse is the rich DTO returned by conversation endpoints.
type ConversationResponse struct {
	*Conversation
	Participants []User      `json:"participants"`
	LastMessage  interface{} `json:"last_message"` // *service.MessageResponse, typed as any to avoid import cycle
	UnreadCount  int         `json:"unread_count"`
}
