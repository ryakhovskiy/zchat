from sqlalchemy import Column, Integer, String, DateTime, Table, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
from ..database import Base

conversation_participants = Table(
    'conversation_participants',
    Base.metadata,
    Column('conversation_id', Integer, ForeignKey('conversations.id')),
    Column('user_id', Integer, ForeignKey('users.id'))
)

class Conversation(Base):
    __tablename__ = "conversations"
    
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    messages = relationship("Message", back_populates="conversation")
    participants = relationship("User", secondary=conversation_participants)
