from sqlalchemy.orm import Session
from ..models.conversation import Conversation
from ..models.user import User
from ..schemas.conversation import ConversationCreate

def create_conversation(db: Session, conversation: ConversationCreate):
    db_conversation = Conversation(title=conversation.title)
    participants = db.query(User).filter(User.id.in_(conversation.participant_ids)).all()
    db_conversation.participants = participants
    db.add(db_conversation)
    db.commit()
    db.refresh(db_conversation)
    return db_conversation

def get_conversation(db: Session, conversation_id: int):
    return db.query(Conversation).filter(Conversation.id == conversation_id).first()

def get_conversations(db: Session, skip: int = 0, limit: int = 100):
    return db.query(Conversation).offset(skip).limit(limit).all()
