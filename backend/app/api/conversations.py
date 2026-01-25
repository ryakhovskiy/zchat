import logging
from fastapi import APIRouter, Depends, status, HTTPException
from sqlalchemy.orm import Session
from typing import List
from pydantic import ValidationError
from app.database import get_db
from app.schemas import (
    ConversationCreate,
    ConversationResponse,
    MessageCreate,
    MessageResponse
)
from app.services.conversation_service import ConversationService
from app.services.message_service import MessageService
from app.utils.security import get_current_user
from app.models.user import User

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)
router = APIRouter(prefix="/conversations", tags=["Conversations"])


@router.post("/", response_model=ConversationResponse, status_code=status.HTTP_201_CREATED)
async def create_conversation(
    conversation_data: ConversationCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Create a new conversation (direct or group).
    
    - **participant_ids**: List of user IDs to include (excluding yourself)
    - **is_group**: Whether this is a group conversation
    - **name**: Optional name for group conversations
    """
    logger.info(
        f"API request: Create conversation by user {current_user.id} "
        f"(is_group={conversation_data.is_group}, participants={conversation_data.participant_ids})"
    )
    logger.debug(f"Conversation data: {conversation_data.dict()}")
    try:
        result = ConversationService.create_conversation(db, conversation_data, current_user)
        logger.info(f"API response: Created conversation {result.id} for user {current_user.id}")
        return result
    except HTTPException as e:
        logger.error(
            f"API error: Failed to create conversation for user {current_user.id}: "
            f"{e.status_code} - {e.detail}"
        )
        raise
    except Exception as e:
        logger.exception(f"API unexpected error: Failed to create conversation for user {current_user.id}: {str(e)}")
        raise


@router.get("/", response_model=List[ConversationResponse])
async def get_conversations(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get all conversations for the current user.
    """
    logger.info(f"API request: Get all conversations for user {current_user.id}")
    try:
        result = ConversationService.get_user_conversations(db, current_user)
        logger.info(f"API response: Returning {len(result)} conversation(s) for user {current_user.id}")
        return result
    except Exception as e:
        logger.exception(f"API unexpected error: Failed to get conversations for user {current_user.id}: {str(e)}")
        raise


@router.get("/{conversation_id}", response_model=ConversationResponse)
async def get_conversation(
    conversation_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get a specific conversation by ID.
    """
    logger.info(f"API request: Get conversation {conversation_id} for user {current_user.id}")
    try:
        result = ConversationService.get_conversation(db, conversation_id, current_user)
        logger.info(f"API response: Returning conversation {conversation_id} for user {current_user.id}")
        return result
    except HTTPException as e:
        logger.error(
            f"API error: Failed to get conversation {conversation_id} for user {current_user.id}: "
            f"{e.status_code} - {e.detail}"
        )
        raise
    except Exception as e:
        logger.exception(f"API unexpected error: Failed to get conversation {conversation_id}: {str(e)}")
        raise


@router.post("/{conversation_id}/read", status_code=status.HTTP_200_OK)
async def mark_conversation_as_read(
    conversation_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Mark all messages in a conversation as read for the current user.
    Updates the last_read_at timestamp to the current time.
    """
    logger.info(f"API request: Mark conversation {conversation_id} as read by user {current_user.id}")
    try:
        result = ConversationService.mark_conversation_as_read(db, conversation_id, current_user)
        logger.info(f"API response: Conversation {conversation_id} marked as read for user {current_user.id}")
        return result
    except HTTPException as e:
        logger.error(
            f"API error: Failed to mark conversation {conversation_id} as read: "
            f"{e.status_code} - {e.detail}"
        )
        raise
    except Exception as e:
        logger.exception(
            f"API unexpected error: Failed to mark conversation {conversation_id} as read: {str(e)}"
        )
        raise


@router.get("/{conversation_id}/messages", response_model=List[MessageResponse])
async def get_conversation_messages(
    conversation_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    limit: int = 1000
):
    """
    Get messages for a conversation (last N messages, max 1000).
    """
    logger.info(
        f"API request: Get messages for conversation {conversation_id} by user {current_user.id} (limit={limit})"
    )
    try:
        result = MessageService.get_conversation_messages(
            db, conversation_id, current_user, limit
        )
        logger.info(
            f"API response: Returning {len(result)} message(s) from conversation {conversation_id} "
            f"for user {current_user.id}"
        )
        return result
    except HTTPException as e:
        logger.error(
            f"API error: Failed to get messages for conversation {conversation_id}: "
            f"{e.status_code} - {e.detail}"
        )
        raise
    except Exception as e:
        logger.exception(
            f"API unexpected error: Failed to get messages for conversation {conversation_id}: {str(e)}"
        )
        raise


@router.post("/{conversation_id}/messages", response_model=MessageResponse, status_code=status.HTTP_201_CREATED)
async def send_message(
    conversation_id: int,
    content: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Send a message in a conversation.
    
    - **content**: Message text (1-5000 chars)
    """
    logger.info(
        f"API request: Send message in conversation {conversation_id} by user {current_user.id} "
        f"(content_length={len(content)})"
    )
    try:
        message_data = MessageCreate(content=content, conversation_id=conversation_id)
    except (ValueError, ValidationError) as e:
        logger.warning(
            f"API validation error: Invalid message data for conversation {conversation_id} "
            f"by user {current_user.id}: {str(e)}"
        )
        raise HTTPException(status_code=422, detail=str(e))
    
    try:
        result = MessageService.create_message(db, message_data, current_user)
        logger.info(
            f"API response: Created message {result.id} in conversation {conversation_id} "
            f"by user {current_user.id}"
        )
        return result
    except HTTPException as e:
        logger.error(
            f"API error: Failed to send message in conversation {conversation_id}: "
            f"{e.status_code} - {e.detail}"
        )
        raise
    except Exception as e:
        logger.exception(
            f"API unexpected error: Failed to send message in conversation {conversation_id}: {str(e)}"
        )
        raise