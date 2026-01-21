import logging
from sqlalchemy.orm import Session
from fastapi import HTTPException, status
from typing import List, Optional
from app.models.conversation import Conversation
from app.models.user import User
from app.schemas import ConversationCreate, ConversationResponse, MessageResponse, UserResponse
from app.services.message_service import MessageService

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)

class ConversationService:
    """Service for conversation operations."""
    
    @staticmethod
    def create_conversation(
        db: Session,
        conversation_data: ConversationCreate,
        creator: User
    ) -> ConversationResponse:
        """Create a new conversation."""
        logger.info(
            f"Creating conversation for user {creator.id}: "
            f"is_group={conversation_data.is_group}, "
            f"participant_count={len(conversation_data.participant_ids) + 1}"
        )
        
        # Get all participants including creator
        participant_ids = set(conversation_data.participant_ids + [creator.id])
        participants = db.query(User).filter(User.id.in_(participant_ids)).all()
        
        if len(participants) != len(participant_ids):
            missing_count = len(participant_ids) - len(participants)
            logger.warning(
                f"Failed to create conversation: {missing_count} participant(s) not found. "
                f"Requested: {participant_ids}, Found: {[p.id for p in participants]}"
            )
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="One or more participants not found"
            )
        
        # For direct conversations, check if one already exists
        if not conversation_data.is_group and len(participants) == 2:
            logger.debug(f"Checking for existing direct conversation between users {[p.id for p in participants]}")
            existing = ConversationService._find_existing_direct_conversation(
                db, [p.id for p in participants]
            )
            if existing:
                logger.info(f"Found existing direct conversation {existing.id}, returning it")
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
        
        logger.info(
            f"Successfully created conversation {new_conversation.id}: "
            f"name='{new_conversation.name}', is_group={new_conversation.is_group}, "
            f"participants={[p.id for p in participants]}"
        )
        
        return ConversationService._conversation_to_response(db, new_conversation)
    
    @staticmethod
    def get_user_conversations(db: Session, user: User) -> List[ConversationResponse]:
        """Get all conversations for a user."""
        logger.debug(f"Fetching conversations for user {user.id}")
        conversations = user.conversations
        logger.info(f"Retrieved {len(conversations)} conversation(s) for user {user.id}")
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
        logger.debug(f"User {user.id} requesting conversation {conversation_id}")
        conversation = db.query(Conversation).filter(
            Conversation.id == conversation_id
        ).first()
        
        if not conversation:
            logger.warning(f"Conversation {conversation_id} not found (requested by user {user.id})")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Conversation not found"
            )
        
        if user not in conversation.participants:
            logger.warning(
                f"User {user.id} denied access to conversation {conversation_id}: not a participant"
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not a participant in this conversation"
            )
        
        logger.info(f"Successfully retrieved conversation {conversation_id} for user {user.id}")
        return ConversationService._conversation_to_response(db, conversation)
    
    @staticmethod
    def _find_existing_direct_conversation(
        db: Session,
        participant_ids: List[int]
    ) -> Optional[Conversation]:
        """Find existing direct conversation between two users."""
        logger.debug(f"Searching for existing direct conversation between users {participant_ids}")
        
        if len(participant_ids) != 2:
            return None
        
        # Import here to avoid circular imports
        from app.models.user import conversation_participants
        from sqlalchemy import func
        
        # Find direct conversations where both users are participants
        # by checking conversations that have exactly these 2 participants
        subquery = (
            db.query(
                conversation_participants.c.conversation_id,
                func.count(conversation_participants.c.user_id).label('participant_count')
            )
            .filter(conversation_participants.c.user_id.in_(participant_ids))
            .group_by(conversation_participants.c.conversation_id)
            .having(func.count(conversation_participants.c.user_id) == 2)
            .subquery()
        )
        
        conversation = (
            db.query(Conversation)
            .join(subquery, Conversation.id == subquery.c.conversation_id)
            .filter(Conversation.is_group == False)
            .first()
        )
        
        if conversation:
            # Verify it has exactly 2 participants (not more)
            if len(conversation.participants) == 2:
                logger.debug(f"Found existing direct conversation {conversation.id}")
                return conversation
        
        logger.debug(f"No existing direct conversation found for users {participant_ids}")
        return None
    
    @staticmethod
    def _conversation_to_response(
        db: Session,
        conversation: Conversation
    ) -> ConversationResponse:
        """Convert Conversation model to response."""
        logger.debug(f"Converting conversation {conversation.id} to response format")
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