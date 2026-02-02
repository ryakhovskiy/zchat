"""Message-related Pydantic schemas."""

from pydantic import BaseModel, Field, validator
from datetime import datetime
from typing import Optional


class MessageBase(BaseModel):
    """Base message schema."""
    content: str = Field(..., min_length=1, max_length=5000)


class MessageCreate(MessageBase):
    """Schema for creating a message."""
    conversation_id: int
    file_path: Optional[str] = None
    file_type: Optional[str] = None
    
    @validator('content')
    def content_not_empty(cls, v, values):
        """Validate content is not empty unless a file is attached."""
        # Note: 'file_path' might not be in values if validation failed for it,
        # but here we assuming simple check.
        # If file_path is present, content can be empty or just a placeholder.
        if 'file_path' in values and values['file_path']:
             return v
             
        if not v.strip():
            raise ValueError('Message content cannot be empty')
        return v.strip()


class MessageUpdate(BaseModel):
    """Schema for updating a message (if needed)."""
    content: str = Field(..., min_length=1, max_length=5000)


class MessageResponse(BaseModel):
    """Schema for message response data."""
    id: int
    content: str  # Decrypted content
    conversation_id: int
    sender_id: int
    sender_username: str
    created_at: datetime
    file_path: Optional[str] = None
    file_type: Optional[str] = None
    is_deleted: bool = False
    
    class Config:
        from_attributes = True


class MessageWithSender(BaseModel):
    """Message with full sender information."""
    id: int
    content: str
    conversation_id: int
    sender_id: int
    sender_username: str
    sender_online: bool
    created_at: datetime


class WSMessage(BaseModel):
    """WebSocket message schema."""
    type: str  # "message", "typing", "online", "offline", "user_online", "user_offline"
    conversation_id: Optional[int] = None
    content: Optional[str] = None
    sender_id: Optional[int] = None
    sender_username: Optional[str] = None
    message_id: Optional[int] = None
    timestamp: Optional[datetime] = None
    user_id: Optional[int] = None  # For user status events
    username: Optional[str] = None  # For user status events