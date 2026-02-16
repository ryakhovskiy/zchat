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

type ConversationCreateInput struct {
	Name           *string
	IsGroup        bool
	ParticipantIDs []int64
}

func (s *ConversationService) CreateConversation(
	ctx context.Context,
	in ConversationCreateInput,
	creatorID int64,
) (*domain.Conversation, error) {
	if len(in.ParticipantIDs) == 0 {
		return nil, errors.New("at least one participant is required")
	}

	// Include creator
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

	// Check for existing conversation with same participants
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
		return existing, nil
	}

	conv := &domain.Conversation{
		Name:    in.Name,
		IsGroup: in.IsGroup,
	}
	if err := s.conversations.Create(ctx, conv, uniqueIDs); err != nil {
		return nil, err
	}
	return conv, nil
}

func (s *ConversationService) ListForUser(ctx context.Context, userID int64) ([]*domain.Conversation, error) {
	return s.conversations.ListForUser(ctx, userID)
}

func (s *ConversationService) GetConversation(
	ctx context.Context,
	conversationID int64,
	userID int64,
) (*domain.Conversation, error) {
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
	return conv, nil
}

func (s *ConversationService) MarkAsRead(
	ctx context.Context,
	conversationID int64,
	userID int64,
) error {
	return s.conversations.MarkAsRead(ctx, conversationID, userID)
}

