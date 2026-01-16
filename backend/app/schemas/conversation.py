from pydantic import BaseModel
from datetime import datetime
from typing import List, Optional

class ConversationBase(BaseModel):
    title: Optional[str] = None

class ConversationCreate(ConversationBase):
    participant_ids: List[int]

class ConversationResponse(ConversationBase):
    id: int
    created_at: datetime
    
    class Config:
        from_attributes = True
