from pydantic import BaseModel, Field, validator
from datetime import datetime
from typing import Optional, List


# User Schemas
class UserBase(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: Optional[str] = Field(None, max_length=100)


class UserCreate(UserBase):
    password: str = Field(..., min_length=6, max_length=100)
    
    @validator('username')
    def username_alphanumeric(cls, v):
        if not v.replace('_', '').replace('-', '').isalnum():
            raise ValueError('Username must be alphanumeric (with _ or - allowed)')
        return v


class UserLogin(BaseModel):
    username: str
    password: str


class UserResponse(UserBase):
    id: int
    is_online: bool
    created_at: datetime
    last_seen: datetime
    
    class Config:
        from_attributes = True


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


# Message Schemas
class MessageCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=5000)
    conversation_id: int


class MessageResponse(BaseModel):
    id: int
    content: str  # Decrypted content
    conversation_id: int
    sender_id: int
    sender_username: str
    created_at: datetime
    
    class Config:
        from_attributes = True


# Conversation Schemas
class ConversationCreate(BaseModel):
    participant_ids: List[int] = Field(..., min_items=1)
    name: Optional[str] = Field(None, max_length=100)
    is_group: bool = False
    
    @validator('participant_ids')
    def validate_participants(cls, v, values):
        if values.get('is_group', False) and len(v) < 2:
            raise ValueError('Group conversations must have at least 2 participants')
        if not values.get('is_group', False) and len(v) != 1:
            raise ValueError('Direct conversations must have exactly 1 other participant')
        return v


class ConversationResponse(BaseModel):
    id: int
    name: Optional[str]
    is_group: bool
    created_at: datetime
    updated_at: datetime
    participants: List[UserResponse]
    last_message: Optional[MessageResponse] = None
    
    class Config:
        from_attributes = True


# WebSocket Schemas
class WSMessage(BaseModel):
    type: str  # "message", "typing", "online", "offline"
    conversation_id: Optional[int] = None
    content: Optional[str] = None
    sender_id: Optional[int] = None
    sender_username: Optional[str] = None
    timestamp: Optional[datetime] = None