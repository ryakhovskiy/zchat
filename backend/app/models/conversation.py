from sqlalchemy import Column, Integer, String, Boolean, DateTime
from sqlalchemy.orm import relationship
from datetime import datetime
from app.database import Base
from app.models.user import conversation_participants


class Conversation(Base):
    """Conversation model for direct and group chats."""
    
    __tablename__ = "conversations"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=True)  # For group chats
    is_group = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    participants = relationship(
        "User",
        secondary=conversation_participants,
        back_populates="conversations"
    )
    messages = relationship(
        "Message",
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="Message.created_at"
    )
    
    def __repr__(self):
        return f"<Conversation {self.id} - {'Group' if self.is_group else 'Direct'}>"