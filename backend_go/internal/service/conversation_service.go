package service

import (
	"context"
	"errors"
	"fmt"

	"backend_go/internal/domain"
)

type ConversationService struct {
	conversations domain.ConversationRepository
	participants  domain.ParticipantRepository
	messages      domain.MessageRepository
	msgSvc        *MessageService // used only in toResponse to decrypt last_message
}

func NewConversationService(
	conversations domain.ConversationRepository,
	participants domain.ParticipantRepository,
	messages domain.MessageRepository,
) *ConversationService {
	return &ConversationService{
		conversations: conversations,
		participants:  participants,
		messages:      messages,
	}
}

// SetMessageService injects MessageService after construction (avoids circular init).
func (s *ConversationService) SetMessageService(msgSvc *MessageService) {
	s.msgSvc = msgSvc
}

type ConversationCreateInput struct {
	Name           *string
	IsGroup        bool
	ParticipantIDs []int64
}

// ConversationResponse is the rich response DTO including participants, last message and unread count.
type ConversationResponse struct {
	*domain.Conversation
	Participants []domain.User    `json:"participants"`
	LastMessage  *MessageResponse `json:"last_message"`
	UnreadCount  int              `json:"unread_count"`
}

func (s *ConversationService) CreateConversation(
	ctx context.Context,
	in ConversationCreateInput,
	creatorID int64,
) (*ConversationResponse, error) {
	// Deduplicate + include creator
	uniqueIDs := make([]int64, 0, len(in.ParticipantIDs)+1)
	seen := map[int64]struct{}{creatorID: {}}
	uniqueIDs = append(uniqueIDs, creatorID)
	for _, id := range in.ParticipantIDs {
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		uniqueIDs = append(uniqueIDs, id)
	}

	// Validation: direct → exactly 1 other; group → at least 2 others
	otherCount := len(uniqueIDs) - 1 // exclude creator
	if !in.IsGroup && otherCount != 1 {
		return nil, errors.New("a direct conversation requires exactly one other participant")
	}
	if in.IsGroup && otherCount < 2 {
		return nil, errors.New("a group conversation requires at least two other participants")
	}

	// Idempotency check
	var existing *domain.Conversation
	var err error
	if !in.IsGroup && len(uniqueIDs) == 2 {
		existing, err = s.conversations.FindExistingDirect(ctx, uniqueIDs)
	} else if in.IsGroup {
		existing, err = s.conversations.FindExistingGroup(ctx, uniqueIDs)
	}
	if err != nil {
		return nil, fmt.Errorf("find existing conversation: %w", err)
	}
	if existing != nil {
		return s.toResponse(ctx, existing, creatorID)
	}

	conv := &domain.Conversation{
		Name:    in.Name,
		IsGroup: in.IsGroup,
	}
	if err := s.conversations.Create(ctx, conv, uniqueIDs); err != nil {
		return nil, err
	}
	return s.toResponse(ctx, conv, creatorID)
}

func (s *ConversationService) ListForUser(ctx context.Context, userID int64) ([]*ConversationResponse, error) {
	convs, err := s.conversations.ListForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	res := make([]*ConversationResponse, 0, len(convs))
	for _, c := range convs {
		r, err := s.toResponse(ctx, c, userID)
		if err != nil {
			return nil, err
		}
		res = append(res, r)
	}
	return res, nil
}

func (s *ConversationService) GetConversation(
	ctx context.Context,
	conversationID int64,
	userID int64,
) (*ConversationResponse, error) {
	conv, err := s.conversations.GetByID(ctx, conversationID)
	if err != nil {
		return nil, err
	}
	if conv == nil {
		return nil, errors.New("conversation not found")
	}
	isParticipant, err := s.participants.IsParticipant(ctx, conversationID, userID)
	if err != nil {
		return nil, err
	}
	if !isParticipant {
		return nil, errors.New("not a participant in this conversation")
	}
	return s.toResponse(ctx, conv, userID)
}

func (s *ConversationService) MarkAsRead(
	ctx context.Context,
	conversationID int64,
	userID int64,
) error {
	return s.conversations.MarkAsRead(ctx, conversationID, userID)
}

// toResponse enriches a bare Conversation with participants, last message and unread count.
func (s *ConversationService) toResponse(ctx context.Context, conv *domain.Conversation, userID int64) (*ConversationResponse, error) {
	users, err := s.participants.ListParticipants(ctx, conv.ID)
	if err != nil {
		return nil, fmt.Errorf("list participants: %w", err)
	}
	participants := make([]domain.User, len(users))
	for i, u := range users {
		participants[i] = *u
	}

	unread, err := s.conversations.GetUnreadCount(ctx, conv.ID, userID)
	if err != nil {
		unread = 0 // non-fatal
	}

	var lastMsg *MessageResponse
	if s.msgSvc != nil {
		msgs, err := s.messages.ListForConversationForUser(ctx, conv.ID, userID, 1)
		if err == nil && len(msgs) > 0 {
			lastMsg, _ = s.msgSvc.ToResponse(ctx, msgs[0])
		}
	}

	return &ConversationResponse{
		Conversation: conv,
		Participants: participants,
		LastMessage:  lastMsg,
		UnreadCount:  unread,
	}, nil
}
