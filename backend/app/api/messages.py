from fastapi import APIRouter, Depends, status, HTTPException, Query
from sqlalchemy.orm import Session
from app.database import get_db
from app.schemas import MessageResponse, MessageEdit
from app.services.message_service import MessageService
from app.utils.security import get_current_user
from app.models.user import User

router = APIRouter(prefix="/messages", tags=["Messages"])

@router.put("/{message_id}", response_model=MessageResponse)
async def update_message(
    message_id: int,
    message_data: MessageEdit,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Edit a message content."""
    return MessageService.edit_message(db, message_id, current_user.id, message_data.content)

@router.delete("/{message_id}", response_model=MessageResponse)
async def delete_message(
    message_id: int,
    delete_type: str = Query("for_me", regex="^(for_me|for_everyone)$"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a message."""
    return MessageService.delete_message(db, message_id, current_user.id, delete_type)
