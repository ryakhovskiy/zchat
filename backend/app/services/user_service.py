"""User service for user-related operations."""

from sqlalchemy.orm import Session
from fastapi import HTTPException, status
from typing import List, Optional
from datetime import datetime
from app.models.user import User
from app.schemas.user import UserUpdate
from app.utils.security import get_password_hash


class UserService:
    """Service for user management operations."""
    
    @staticmethod
    def get_user_by_id(db: Session, user_id: int) -> Optional[User]:
        """Get user by ID."""
        return db.query(User).filter(User.id == user_id).first()
    
    @staticmethod
    def get_user_by_username(db: Session, username: str) -> Optional[User]:
        """Get user by username."""
        return db.query(User).filter(User.username == username).first()
    
    @staticmethod
    def get_user_by_email(db: Session, email: str) -> Optional[User]:
        """Get user by email."""
        return db.query(User).filter(User.email == email).first()
    
    @staticmethod
    def get_all_users(db: Session, skip: int = 0, limit: int = 100) -> List[User]:
        """Get all active users."""
        return db.query(User).filter(
            User.is_active == True
        ).offset(skip).limit(limit).all()
    
    @staticmethod
    def get_online_users(db: Session) -> List[User]:
        """Get all currently online users."""
        return db.query(User).filter(
            User.is_active == True,
            User.is_online == True
        ).all()
    
    @staticmethod
    def update_user(
        db: Session,
        user: User,
        user_update: UserUpdate
    ) -> User:
        """Update user information."""
        update_data = user_update.model_dump(exclude_unset=True)
        
        # Hash password if being updated
        if 'password' in update_data:
            update_data['hashed_password'] = get_password_hash(update_data.pop('password'))
        
        # Check if email is being changed and already exists
        if 'email' in update_data and update_data['email']:
            existing_email = UserService.get_user_by_email(db, update_data['email'])
            if existing_email and existing_email.id != user.id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Email already registered"
                )
        
        for field, value in update_data.items():
            setattr(user, field, value)
        
        db.commit()
        db.refresh(user)
        return user
    
    @staticmethod
    def delete_user(db: Session, user: User) -> bool:
        """Soft delete user (set is_active to False)."""
        user.is_active = False
        user.is_online = False
        db.commit()
        return True
    
    @staticmethod
    def hard_delete_user(db: Session, user: User) -> bool:
        """Permanently delete user from database."""
        db.delete(user)
        db.commit()
        return True
    
    @staticmethod
    def set_user_online_status(db: Session, user: User, is_online: bool):
        """Update user online status."""
        user.is_online = is_online
        user.last_seen = datetime.utcnow()
        db.commit()
    
    @staticmethod
    def update_last_seen(db: Session, user: User):
        """Update user's last seen timestamp."""
        user.last_seen = datetime.utcnow()
        db.commit()
    
    @staticmethod
    def search_users(db: Session, query: str, limit: int = 20) -> List[User]:
        """Search users by username."""
        return db.query(User).filter(
            User.is_active == True,
            User.username.contains(query.lower())
        ).limit(limit).all()
    
    @staticmethod
    def get_user_stats(db: Session, user: User) -> dict:
        """Get statistics for a user."""
        from app.models.conversation import Conversation
        from app.models.message import Message
        
        # Count conversations
        conversation_count = len(user.conversations)
        
        # Count messages sent
        message_count = db.query(Message).filter(
            Message.sender_id == user.id
        ).count()
        
        return {
            "user_id": user.id,
            "username": user.username,
            "conversation_count": conversation_count,
            "message_count": message_count,
            "account_age_days": (datetime.utcnow() - user.created_at).days,
            "is_online": user.is_online,
            "last_seen": user.last_seen,
        }