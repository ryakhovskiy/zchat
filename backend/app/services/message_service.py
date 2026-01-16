from sqlalchemy.orm import Session
from ..models.message import Message
from ..schemas.message import MessageCreate

def create_message(db: Session, message: MessageCreate, sender_id: int):
    db_message = Message(
        content=message.content,
        sender_id=sender_id,
        conversation_id=message.conversation_id
    )
    db.add(db_message)
    db.commit()
    db.refresh(db_message)
    return db_message

def get_messages(db: Session, conversation_id: int, skip: int = 0, limit: int = 100):
    return db.query(Message).filter(
        Message.conversation_id == conversation_id
    ).offset(skip).limit(limit).all()
