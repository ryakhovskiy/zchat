package domain

import (
	"context"
)

// UserRepository defines persistence operations for users.
type UserRepository interface {
	Create(ctx context.Context, u *User) error
	GetByID(ctx context.Context, id int64) (*User, error)
	GetByUsername(ctx context.Context, username string) (*User, error)
	GetByEmail(ctx context.Context, email string) (*User, error)
	ListActive(ctx context.Context, offset, limit int) ([]*User, error)
	ListOnline(ctx context.Context) ([]*User, error)
	Update(ctx context.Context, u *User) error
	SoftDelete(ctx context.Context, id int64) error
	SetOnlineStatus(ctx context.Context, id int64, isOnline bool) error
}

// ConversationRepository defines persistence operations for conversations.
type ConversationRepository interface {
	Create(ctx context.Context, c *Conversation, participantIDs []int64) error
	GetByID(ctx context.Context, id int64) (*Conversation, error)
	ListForUser(ctx context.Context, userID int64) ([]*Conversation, error)
	MarkAsRead(ctx context.Context, conversationID, userID int64) error
	GetUnreadCount(ctx context.Context, conversationID, userID int64) (int, error)
	FindExistingDirect(ctx context.Context, participantIDs []int64) (*Conversation, error)
	FindExistingGroup(ctx context.Context, participantIDs []int64) (*Conversation, error)
}

// MessageRepository defines persistence operations for messages.
type MessageRepository interface {
	Create(ctx context.Context, m *Message) error
	ListForConversation(ctx context.Context, conversationID int64, limit int) ([]*Message, error)
	PruneOld(ctx context.Context, conversationID int64, keepLimit int) error
}

// ParticipantRepository defines operations around conversation participants.
type ParticipantRepository interface {
	ListParticipants(ctx context.Context, conversationID int64) ([]*User, error)
	IsParticipant(ctx context.Context, conversationID, userID int64) (bool, error)
}

