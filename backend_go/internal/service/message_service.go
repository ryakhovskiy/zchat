package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"backend_go/internal/domain"
	"backend_go/internal/security"
)

type MessageService struct {
	conversations domain.ConversationRepository
	participants  domain.ParticipantRepository
	messages      domain.MessageRepository
	users         domain.UserRepository
	encryptor     *security.Encryptor

	MaxMessagesPerConversation int
}

func NewMessageService(
	conversations domain.ConversationRepository,
	participants domain.ParticipantRepository,
	messages domain.MessageRepository,
	users domain.UserRepository,
	encryptor *security.Encryptor,
	maxMessages int,
) *MessageService {
	return &MessageService{
		conversations:             conversations,
		participants:              participants,
		messages:                  messages,
		users:                     users,
		encryptor:                 encryptor,
		MaxMessagesPerConversation: maxMessages,
	}
}

type MessageCreateInput struct {
	ConversationID int64
	Content        string
	FilePath       *string
	FileType       *string
}

func (s *MessageService) CreateMessage(
	ctx context.Context,
	in MessageCreateInput,
	senderID int64,
) (*domain.Message, error) {
	// Ensure conversation exists and user is participant
	conv, err := s.conversations.GetByID(ctx, in.ConversationID)
	if err != nil {
		return nil, fmt.Errorf("get conversation: %w", err)
	}
	if conv == nil {
		return nil, errors.New("conversation not found")
	}
	isParticipant, err := s.participants.IsParticipant(ctx, in.ConversationID, senderID)
	if err != nil {
		return nil, fmt.Errorf("check participant: %w", err)
	}
	if !isParticipant {
		return nil, errors.New("you are not a participant in this conversation")
	}

	if in.Content == "" && (in.FilePath == nil || *in.FilePath == "") {
		return nil, errors.New("message content cannot be empty")
	}

	encrypted, err := s.encryptor.Encrypt(in.Content)
	if err != nil {
		return nil, fmt.Errorf("encrypt content: %w", err)
	}

	msg := &domain.Message{
		Content:        encrypted,
		ConversationID: in.ConversationID,
		SenderID:       senderID,
		FilePath:       in.FilePath,
		FileType:       in.FileType,
		IsDeleted:      false,
	}

	if err := s.messages.Create(ctx, msg); err != nil {
		return nil, err
	}

	// Prune old messages
	if s.MaxMessagesPerConversation > 0 {
		if err := s.messages.PruneOld(ctx, in.ConversationID, s.MaxMessagesPerConversation); err != nil {
			return nil, fmt.Errorf("prune old messages: %w", err)
		}
	}

	return msg, nil
}

func (s *MessageService) ListMessages(
	ctx context.Context,
	conversationID int64,
	userID int64,
	limit int,
) ([]*domain.Message, error) {
	// Ensure conversation exists and user is participant
	conv, err := s.conversations.GetByID(ctx, conversationID)
	if err != nil {
		return nil, fmt.Errorf("get conversation: %w", err)
	}
	if conv == nil {
		return nil, errors.New("conversation not found")
	}
	isParticipant, err := s.participants.IsParticipant(ctx, conversationID, userID)
	if err != nil {
		return nil, fmt.Errorf("check participant: %w", err)
	}
	if !isParticipant {
		return nil, errors.New("you are not a participant in this conversation")
	}

	if limit <= 0 || limit > s.MaxMessagesPerConversation {
		limit = s.MaxMessagesPerConversation
	}

	msgs, err := s.messages.ListForConversation(ctx, conversationID, limit)
	if err != nil {
		return nil, err
	}

	// Reverse slice to chronological order
	for i, j := 0, len(msgs)-1; i < j; i, j = i+1, j-1 {
		msgs[i], msgs[j] = msgs[j], msgs[i]
	}
	return msgs, nil
}

// MessageResponse mirrors the API response expected by the frontend.
type MessageResponse struct {
	ID             int64      `json:"id"`
	Content        string     `json:"content"`
	ConversationID int64      `json:"conversation_id"`
	SenderID       int64      `json:"sender_id"`
	SenderUsername string     `json:"sender_username"`
	CreatedAt      time.Time  `json:"created_at"`
	FilePath       *string    `json:"file_path,omitempty"`
	FileType       *string    `json:"file_type,omitempty"`
	IsDeleted      bool       `json:"is_deleted"`
}

// ToResponse converts a domain message into a decrypted response DTO.
func (s *MessageService) ToResponse(ctx context.Context, m *domain.Message) (*MessageResponse, error) {
	content, err := s.encryptor.Decrypt(m.Content)
	if err != nil {
		return nil, fmt.Errorf("decrypt message: %w", err)
	}
	var username string
	if u, err := s.users.GetByID(ctx, m.SenderID); err == nil && u != nil {
		username = u.Username
	}
	return &MessageResponse{
		ID:             m.ID,
		Content:        content,
		ConversationID: m.ConversationID,
		SenderID:       m.SenderID,
		SenderUsername: username,
		CreatedAt:      m.CreatedAt,
		FilePath:       m.FilePath,
		FileType:       m.FileType,
		IsDeleted:      m.IsDeleted,
	}, nil
}

// ToResponses converts a slice of domain messages into response DTOs.
func (s *MessageService) ToResponses(ctx context.Context, msgs []*domain.Message) ([]*MessageResponse, error) {
	res := make([]*MessageResponse, 0, len(msgs))
	for _, m := range msgs {
		dto, err := s.ToResponse(ctx, m)
		if err != nil {
			return nil, err
		}
		res = append(res, dto)
	}
	return res, nil
}


