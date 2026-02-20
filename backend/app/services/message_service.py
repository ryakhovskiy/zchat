from sqlalchemy.orm import Session
from sqlalchemy import desc
from fastapi import HTTPException, status
from typing import List
from app.models.message import Message, UserDeletedMessage
from app.models.conversation import Conversation
from app.models.user import User
from app.schemas import MessageCreate, MessageResponse
from app.utils.encryption import message_encryption
from app.config import get_settings

settings = get_settings()


class MessageService:
    """Service for message operations."""
    
    @staticmethod
    def create_message(
        db: Session,
        message_data: MessageCreate,
        sender: User
    ) -> MessageResponse:
        """Create a new message with encryption."""
        # Verify conversation exists and user is participant
        conversation = db.query(Conversation).filter(
            Conversation.id == message_data.conversation_id
        ).first()
        
        if not conversation:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Conversation not found"
            )
        
        if sender not in conversation.participants:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not a participant in this conversation"
            )
        
        # Encrypt message content
        encrypted_content = message_encryption.encrypt(message_data.content)
        
        # Create message
        new_message = Message(
            content=encrypted_content,
            conversation_id=message_data.conversation_id,
            sender_id=sender.id,
            file_path=message_data.file_path,
            file_type=message_data.file_type
        )
        
        db.add(new_message)
        db.commit()
        db.refresh(new_message)
        
        # Prune old messages if limit exceeded
        MessageService._prune_old_messages(db, message_data.conversation_id)
        
        # Return decrypted message
        return MessageService._message_to_response(new_message)
    
    @staticmethod
    def get_conversation_messages(
        db: Session,
        conversation_id: int,
        user: User,
        limit: int = None
    ) -> List[MessageResponse]:
        """Get messages for a conversation (last N messages)."""
        # Verify conversation exists and user is participant
        conversation = db.query(Conversation).filter(
            Conversation.id == conversation_id
        ).first()
        
        if not conversation:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Conversation not found"
            )
        
        if user not in conversation.participants:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not a participant in this conversation"
            )
        
        # Get last N messages
        if limit is None:
            limit = settings.MAX_MESSAGES_PER_CONVERSATION
        
        # Subquery to filter out deleted messages for the user
        deleted_for_me = db.query(UserDeletedMessage.message_id).filter(
            UserDeletedMessage.user_id == user.id
        )

        messages = db.query(Message).filter(
            Message.conversation_id == conversation_id,
            ~Message.id.in_(deleted_for_me)
        ).order_by(desc(Message.created_at)).limit(limit).all()
        
        # Reverse to chronological order and decrypt
        messages.reverse()
        return [MessageService._message_to_response(msg) for msg in messages]

    @staticmethod
    def edit_message(db: Session, message_id: int, user_id: int, content: str) -> MessageResponse:
        """Edit a message content."""
        message = db.query(Message).filter(Message.id == message_id).first()
        if not message:
            raise HTTPException(status_code=404, detail="Message not found")
            
        if message.sender_id != user_id:
            raise HTTPException(status_code=403, detail="Not authorized to edit this message")
            
        if message.is_deleted:
            raise HTTPException(status_code=400, detail="Cannot edit a deleted message")
            
        # Encrypt updated content
        encrypted_content = message_encryption.encrypt(content)
        message.content = encrypted_content
        message.is_edited = True
        
        db.commit()
        db.refresh(message)
        return MessageService._message_to_response(message)

    @staticmethod
    def delete_message(db: Session, message_id: int, user_id: int, delete_type: str) -> MessageResponse:
        """Delete a message (for me or for everyone)."""
        message = db.query(Message).filter(Message.id == message_id).first()
        if not message:
            raise HTTPException(status_code=404, detail="Message not found")
            
        if delete_type == "for_everyone":
            if message.sender_id != user_id:
                raise HTTPException(status_code=403, detail="Not authorized to delete this message for everyone")
            
            message.is_deleted = True
            db.commit()
            return MessageService._message_to_response(message)
            
        elif delete_type == "for_me":
             # Check if already deleted for this user
            existing = db.query(UserDeletedMessage).filter_by(
                user_id=user_id, 
                message_id=message_id
            ).first()
            
            if not existing:
                user_deleted = UserDeletedMessage(user_id=user_id, message_id=message_id)
                db.add(user_deleted)
                db.commit()
            
            # Since message is deleted for user, return None or handled by caller?
            # Returns message but caller should know it's deleted for them.
            # But the websocket event should probably not be broadcast if it's "for_me"
            return MessageService._message_to_response(message)
            
        else:
             raise HTTPException(status_code=400, detail="Invalid delete type")
    
    @staticmethod
    def _prune_old_messages(db: Session, conversation_id: int):
        """Remove messages beyond the limit."""
        message_count = db.query(Message).filter(
            Message.conversation_id == conversation_id
        ).count()
        
        if message_count > settings.MAX_MESSAGES_PER_CONVERSATION:
            # Get IDs of messages to delete
            messages_to_delete = db.query(Message.id).filter(
                Message.conversation_id == conversation_id
            ).order_by(Message.created_at).limit(
                message_count - settings.MAX_MESSAGES_PER_CONVERSATION
            ).all()
            
            # Delete old messages
            db.query(Message).filter(
                Message.id.in_([m.id for m in messages_to_delete])
            ).delete(synchronize_session=False)
            
            db.commit()
    
    @staticmethod
    def _message_to_response(message: Message) -> MessageResponse:
        """Convert Message model to response with decryption."""
        decrypted_content = message_encryption.decrypt(message.content)
        
        return MessageResponse(
            id=message.id,
            content=decrypted_content,
            conversation_id=message.conversation_id,
            sender_id=message.sender_id,
            sender_username=message.sender.username,
            created_at=message.created_at,
            file_path=message.file_path,
            file_type=message.file_type,
            is_deleted=bool(message.is_deleted),
            is_edited=bool(message.is_edited)
        )