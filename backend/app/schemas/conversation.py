"""Conversation-related Pydantic schemas."""

from pydantic import BaseModel, Field, validator, model_validator
from datetime import datetime
from typing import Optional, List
from app.schemas.user import UserResponse
from app.schemas.message import MessageResponse
import logging

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)

class ConversationBase(BaseModel):
    """Base conversation schema."""
    name: Optional[str] = Field(None, max_length=100)
    is_group: bool = False


class ConversationCreate(ConversationBase):
    """Schema for creating a conversation."""
    participant_ids: List[int] = Field(..., min_items=1)
    
    @model_validator(mode="before")
    def validate_conversation(cls, data):
        """Validate conversation requirements based on type."""
        if not isinstance(data, dict):
            return data

        is_group = data.get('is_group', False)
        participant_ids = data.get('participant_ids', []) or []
        name = data.get('name')

        # Remove duplicates from participant_ids while preserving order
        unique_ids = []
        seen = set()
        for participant_id in participant_ids:
            if participant_id not in seen:
                seen.add(participant_id)
                unique_ids.append(participant_id)
        data['participant_ids'] = unique_ids

        # Validate participant count based on conversation type
        if is_group and len(unique_ids) < 2:
            raise ValueError('Group conversations must have at least 2 other participants')

        if not is_group and len(unique_ids) != 1:
            raise ValueError('Direct conversations must have exactly 1 other participant')

        # Clear name for direct conversations
        if name and not is_group:
            data['name'] = None

        return data


class ConversationUpdate(BaseModel):
    """Schema for updating a conversation."""
    name: Optional[str] = Field(None, max_length=100)


class ConversationResponse(BaseModel):
    """Schema for conversation response data."""
    id: int
    name: Optional[str]
    is_group: bool
    created_at: datetime
    updated_at: datetime
    participants: List[UserResponse]
    last_message: Optional[MessageResponse] = None
    unread_count: Optional[int] = 0  # For future implementation
    
    class Config:
        from_attributes = True


class ConversationList(BaseModel):
    """Schema for listing conversations."""
    id: int
    name: Optional[str]
    is_group: bool
    updated_at: datetime
    participants_count: int
    last_message_preview: Optional[str] = None
    last_message_time: Optional[datetime] = None
    
    class Config:
        from_attributes = True


class ConversationWithMessages(ConversationResponse):
    """Conversation with message history."""
    messages: List[MessageResponse] = []