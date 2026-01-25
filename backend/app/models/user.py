from sqlalchemy import Column, Integer, String, Boolean, DateTime, Table, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
from app.database import Base


# Association table for conversation participants with read tracking
conversation_participants = Table(
    'conversation_participants',
    Base.metadata,
    Column('user_id', Integer, ForeignKey('users.id'), primary_key=True),
    Column('conversation_id', Integer, ForeignKey('conversations.id'), primary_key=True),
    Column('last_read_at', DateTime, nullable=True),
    Column('joined_at', DateTime, default=datetime.utcnow)
)


class User(Base):
    """User model for authentication and profile."""
    
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, nullable=False, index=True)
    email = Column(String(100), unique=True, nullable=True)
    hashed_password = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True)
    is_online = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_seen = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    messages = relationship("Message", back_populates="sender", cascade="all, delete-orphan")
    conversations = relationship(
        "Conversation",
        secondary=conversation_participants,
        back_populates="participants"
    )
    
    def __repr__(self):
        return f"<User {self.username}>"