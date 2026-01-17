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
    return ConversationService.create_conversation(db, conversation_data, current_user)


@router.get("/", response_model=List[ConversationResponse])
async def get_conversations(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get all conversations for the current user.
    """
    return ConversationService.get_user_conversations(db, current_user)


@router.get("/{conversation_id}", response_model=ConversationResponse)
async def get_conversation(
    conversation_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get a specific conversation by ID.
    """
    return ConversationService.get_conversation(db, conversation_id, current_user)


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
    return MessageService.get_conversation_messages(
        db, conversation_id, current_user, limit
    )


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
    try:
        message_data = MessageCreate(content=content, conversation_id=conversation_id)
    except (ValueError, ValidationError) as e:
        raise HTTPException(status_code=422, detail=str(e))
    return MessageService.create_message(db, message_data, current_user)