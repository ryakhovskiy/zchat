from sqlalchemy.orm import Session
from fastapi import HTTPException, status
from typing import List, Optional
from app.models.conversation import Conversation
from app.models.user import User
from app.schemas import ConversationCreate, ConversationResponse, MessageResponse, UserResponse
from app.services.message_service import MessageService


class ConversationService:
    """Service for conversation operations."""
    
    @staticmethod
    def create_conversation(
        db: Session,
        conversation_data: ConversationCreate,
        creator: User
    ) -> ConversationResponse:
        """Create a new conversation."""
        # Get all participants including creator
        participant_ids = set(conversation_data.participant_ids + [creator.id])
        participants = db.query(User).filter(User.id.in_(participant_ids)).all()
        
        if len(participants) != len(participant_ids):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="One or more participants not found"
            )
        
        # For direct conversations, check if one already exists
        if not conversation_data.is_group and len(participants) == 2:
            existing = ConversationService._find_existing_direct_conversation(
                db, [p.id for p in participants]
            )
            if existing:
                return ConversationService._conversation_to_response(db, existing)
        
        # Create new conversation
        new_conversation = Conversation(
            name=conversation_data.name,
            is_group=conversation_data.is_group,
            participants=participants
        )
        
        db.add(new_conversation)
        db.commit()
        db.refresh(new_conversation)
        
        return ConversationService._conversation_to_response(db, new_conversation)
    
    @staticmethod
    def get_user_conversations(db: Session, user: User) -> List[ConversationResponse]:
        """Get all conversations for a user."""
        conversations = user.conversations
        return [
            ConversationService._conversation_to_response(db, conv)
            for conv in conversations
        ]
    
    @staticmethod
    def get_conversation(
        db: Session,
        conversation_id: int,
        user: User
    ) -> ConversationResponse:
        """Get a specific conversation."""
        conversation = db.query(Conversation).filter(
            Conversation.id == conversation_id
        ).first()
        
        if not conversation:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Conversation not found"
            )
        
        if user not in conversation.participants:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not a participant in this conversation"
            )
        
        return ConversationService._conversation_to_response(db, conversation)
    
    @staticmethod
    def _find_existing_direct_conversation(
        db: Session,
        participant_ids: List[int]
    ) -> Optional[Conversation]:
        """Find existing direct conversation between two users."""
        conversations = db.query(Conversation).filter(
            Conversation.is_group == False
        ).all()
        
        for conv in conversations:
            conv_participant_ids = {p.id for p in conv.participants}
            if conv_participant_ids == set(participant_ids):
                return conv
        
        return None
    
    @staticmethod
    def _conversation_to_response(
        db: Session,
        conversation: Conversation
    ) -> ConversationResponse:
        """Convert Conversation model to response."""
        # Get last message if exists
        last_message = None
        if conversation.messages:
            last_msg = conversation.messages[-1]
            last_message = MessageService._message_to_response(last_msg)
        
        return ConversationResponse(
            id=conversation.id,
            name=conversation.name,
            is_group=conversation.is_group,
            created_at=conversation.created_at,
            updated_at=conversation.updated_at,
            participants=[
                UserResponse.from_orm(p) for p in conversation.participants
            ],
            last_message=last_message
        )