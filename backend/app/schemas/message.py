"""Message-related Pydantic schemas."""

from pydantic import BaseModel, Field, validator
from datetime import datetime
from typing import Optional


class MessageBase(BaseModel):
    """Base message schema."""
    content: str = Field(..., min_length=1, max_length=5000)


class MessageEdit(BaseModel):
    """Schema for editing a message."""
    content: str = Field(..., min_length=1, max_length=5000)

    @validator('content')
    def content_not_empty(cls, v):
        if not v.strip():
            raise ValueError('Message content cannot be empty')
        return v.strip()


class MessageDelete(BaseModel):
    """Schema for deleting a message."""
    delete_type: str = Field(..., pattern="^(for_me|for_everyone)$")


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
    is_edited: bool = False
    is_read: bool = False
    
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
    type: str  # "message", "typing", "online", "offline", "user_online", "user_offline", "call_offer", "call_answer", "ice_candidate", "call_end", "call_rejected", "mark_read", "messages_read"
    conversation_id: Optional[int] = None
    content: Optional[str] = None
    sender_id: Optional[int] = None
    sender_username: Optional[str] = None
    message_id: Optional[int] = None
    timestamp: Optional[datetime] = None
    user_id: Optional[int] = None  # For user status events
    username: Optional[str] = None  # For user status events
    is_read: Optional[bool] = None  # Read receipt status
    
    # Signaling fields for calls
    target_user_id: Optional[int] = None
    sdp: Optional[dict] = None
    candidate: Optional[dict] = None