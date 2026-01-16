"""Conversation-related Pydantic schemas."""

from pydantic import BaseModel, Field, validator
from datetime import datetime
from typing import Optional, List
from app.schemas.user import UserResponse
from app.schemas.message import MessageResponse


class ConversationBase(BaseModel):
    """Base conversation schema."""
    name: Optional[str] = Field(None, max_length=100)
    is_group: bool = False


class ConversationCreate(ConversationBase):
    """Schema for creating a conversation."""
    participant_ids: List[int] = Field(..., min_items=1)
    
    @validator('participant_ids')
    def validate_participants(cls, v, values):
        """Validate participant requirements based on conversation type."""
        is_group = values.get('is_group', False)
        
        # Remove duplicates
        unique_ids = list(set(v))
        
        if is_group and len(unique_ids) < 2:
            raise ValueError('Group conversations must have at least 2 other participants')
        
        if not is_group and len(unique_ids) != 1:
            raise ValueError('Direct conversations must have exactly 1 other participant')
        
        return unique_ids
    
    @validator('name')
    def validate_group_name(cls, v, values):
        """Validate group name if it's a group conversation."""
        is_group = values.get('is_group', False)
        
        if v and not is_group:
            # Name provided for direct message, ignore it
            return None
        
        return v


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