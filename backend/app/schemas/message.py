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
    
    @validator('content')
    def content_not_empty(cls, v):
        """Validate content is not just whitespace."""
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