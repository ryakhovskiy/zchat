from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from ..database import get_db
from ..schemas.conversation import ConversationCreate, ConversationResponse
from ..services.conversation_service import create_conversation, get_conversation, get_conversations

router = APIRouter(prefix="/conversations", tags=["Conversations"])

@router.post("/", response_model=ConversationResponse)
async def create_new_conversation(
    conversation: ConversationCreate,
    db: Session = Depends(get_db)
):
    return create_conversation(db, conversation)

@router.get("/{conversation_id}", response_model=ConversationResponse)
async def read_conversation(conversation_id: int, db: Session = Depends(get_db)):
    conversation = get_conversation(db, conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation

@router.get("/", response_model=List[ConversationResponse])
async def list_conversations(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    return get_conversations(db, skip=skip, limit=limit)
