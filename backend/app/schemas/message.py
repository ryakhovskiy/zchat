from pydantic import BaseModel
from datetime import datetime

class MessageBase(BaseModel):
    content: str

class MessageCreate(MessageBase):
    conversation_id: int

class MessageResponse(MessageBase):
    id: int
    sender_id: int
    conversation_id: int
    created_at: datetime
    
    class Config:
        from_attributes = True
