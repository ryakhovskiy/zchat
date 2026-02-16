from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime
from app.database import Base


class Message(Base):
    """Message model with encryption support."""
    
    __tablename__ = "messages"
    
    id = Column(Integer, primary_key=True, index=True)
    content = Column(Text, nullable=False)  # Encrypted content
    conversation_id = Column(Integer, ForeignKey("conversations.id"), nullable=False, index=True)
    sender_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    
    # File attachment fields
    file_path = Column(Text, nullable=True)
    file_type = Column(String, nullable=True)
    fully_read_at = Column(DateTime, nullable=True)
    is_deleted = Column(Integer, default=0) # SQLite uses Integer for Boolean
    is_read = Column(Boolean, default=False)
    
    # Relationships
    conversation = relationship("Conversation", back_populates="messages")
    sender = relationship("User", back_populates="messages")
    
    def __repr__(self):
        return f"<Message {self.id} from User {self.sender_id}>"