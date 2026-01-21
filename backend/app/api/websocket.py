from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError
from typing import Dict
from datetime import datetime
import json
import logging
from app.database import get_db, SessionLocal
from app.models.user import User
from app.schemas import MessageCreate, WSMessage
from app.services.message_service import MessageService
from app.utils.security import decode_token

logger = logging.getLogger(__name__)
router = APIRouter()


class ConnectionManager:
    """Manage WebSocket connections."""
    
    def __init__(self):
        # user_id -> WebSocket connection
        self.active_connections: Dict[int, WebSocket] = {}
    
    async def connect(self, user_id: int, websocket: WebSocket):
        """Accept and store WebSocket connection."""
        await websocket.accept()
        self.active_connections[user_id] = websocket
    
    def disconnect(self, user_id: int):
        """Remove WebSocket connection."""
        if user_id in self.active_connections:
            del self.active_connections[user_id]
    
    async def send_personal_message(self, message: dict, user_id: int):
        """Send message to specific user."""
        if user_id in self.active_connections:
            try:
                await self.active_connections[user_id].send_json(message)
            except Exception as e:
                logger.error(f"Error sending message to user {user_id}: {e}")
                self.disconnect(user_id)
    
    async def broadcast_to_conversation(
        self,
        message: dict,
        conversation_id: int,
        participant_ids: list,
        exclude_user_id: int = None
    ):
        """Send message to all participants in a conversation."""
        for user_id in participant_ids:
            if user_id != exclude_user_id:
                await self.send_personal_message(message, user_id)


manager = ConnectionManager()


async def get_current_user_ws(
    token: str = Query(...),
    db: Session = Depends(get_db)
) -> User:
    """Authenticate WebSocket connection via token."""
    try:
        payload = decode_token(token)
        username = payload.get("sub")
        user = db.query(User).filter(User.username == username).first()
        if not user:
            raise Exception("User not found")
        return user
    except Exception:
        raise Exception("Authentication failed")


@router.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    token: str = Query(...)
):
    """
    WebSocket endpoint for real-time messaging.
    
    Connect with: ws://localhost:8000/ws?token=YOUR_JWT_TOKEN
    
    Message format:
    {
        "type": "message",
        "conversation_id": 1,
        "content": "Hello!"
    }
    
    Response format:
    {
        "type": "message",
        "conversation_id": 1,
        "content": "Hello!",
        "sender_id": 1,
        "sender_username": "john",
        "timestamp": "2024-01-01T12:00:00"
    }
    """
    # Create dedicated session for this WebSocket connection
    db = SessionLocal()
    current_user = None
    user_id = None
    
    try:
        # Authenticate user with dedicated session
        try:
            payload = decode_token(token)
            username = payload.get("sub")
            current_user = db.query(User).filter(
                User.username == username,
                User.is_active == True
            ).first()
            if not current_user:
                await websocket.close(code=1008, reason="User not found or inactive")
                return
            user_id = current_user.id
        except Exception as e:
            logger.error(f"WebSocket authentication failed: {e}")
            await websocket.close(code=1008, reason="Authentication failed")
            return
        
        # Connect
        await manager.connect(current_user.id, websocket)
        
        # Mark user as online with proper transaction
        try:
            db.refresh(current_user)  # Ensure fresh state
            current_user.is_online = True
            db.commit()
        except SQLAlchemyError as e:
            logger.error(f"Failed to update user online status: {e}")
            db.rollback()
            await websocket.close(code=1011, reason="Database error")
            return
        
        # Broadcast online status
        await manager.broadcast_to_conversation(
            {
                "type": "user_online",
                "user_id": current_user.id,
                "username": current_user.username
            },
            conversation_id=None,
            participant_ids=list(manager.active_connections.keys())
        )
        
        try:
            while True:
                # Receive message
                data = await websocket.receive_json()
                
                if data.get("type") == "message":
                    try:
                        # Create and save message
                        message_data = MessageCreate(
                            content=data["content"],
                            conversation_id=data["conversation_id"]
                        )
                        
                        # Refresh user to avoid stale state
                        db.refresh(current_user)
                        message_response = MessageService.create_message(
                            db, message_data, current_user
                        )
                        
                        # Get conversation participants
                        from app.models.conversation import Conversation
                        conversation = db.query(Conversation).filter(
                            Conversation.id == data["conversation_id"]
                        ).first()
                        
                        if conversation:
                            participant_ids = [p.id for p in conversation.participants]
                            
                            # Broadcast to conversation participants
                            ws_message = {
                                "type": "message",
                                "conversation_id": message_response.conversation_id,
                                "content": message_response.content,
                                "sender_id": message_response.sender_id,
                                "sender_username": message_response.sender_username,
                                "message_id": message_response.id,
                                "timestamp": message_response.created_at.isoformat()
                            }
                            
                            await manager.broadcast_to_conversation(
                                ws_message,
                                data["conversation_id"],
                                participant_ids
                            )
                    except SQLAlchemyError as e:
                        logger.error(f"Database error processing message: {e}")
                        db.rollback()
                        await websocket.send_json({
                            "type": "error",
                            "message": "Failed to send message"
                        })
                    except Exception as e:
                        logger.error(f"Error processing message: {e}")
                        await websocket.send_json({
                            "type": "error",
                            "message": "Failed to process message"
                        })
                
                elif data.get("type") == "typing":
                    try:
                        # Broadcast typing indicator
                        from app.models.conversation import Conversation
                        conversation = db.query(Conversation).filter(
                            Conversation.id == data["conversation_id"]
                        ).first()
                        
                        if conversation:
                            participant_ids = [p.id for p in conversation.participants]
                            await manager.broadcast_to_conversation(
                                {
                                    "type": "typing",
                                    "conversation_id": data["conversation_id"],
                                    "user_id": current_user.id,
                                    "username": current_user.username
                                },
                                data["conversation_id"],
                                participant_ids,
                                exclude_user_id=current_user.id
                            )
                    except Exception as e:
                        logger.error(f"Error processing typing indicator: {e}")
        
        except WebSocketDisconnect:
            logger.info(f"WebSocket disconnected for user {user_id}")
    
    except Exception as e:
        logger.error(f"Unexpected WebSocket error: {e}")
        if websocket.client_state.name == "CONNECTED":
            try:
                await websocket.close(code=1011, reason="Internal error")
            except Exception:
                pass
    
    finally:
        # Cleanup connection
        if user_id:
            manager.disconnect(user_id)
        
        # Mark user as offline with proper transaction and error handling
        if current_user:
            try:
                # Create a new session for cleanup to avoid using closed/invalid session
                cleanup_db = SessionLocal()
                try:
                    # Get fresh user instance
                    user_to_update = cleanup_db.query(User).filter(
                        User.id == current_user.id
                    ).with_for_update().first()
                    
                    if user_to_update:
                        user_to_update.is_online = False
                        user_to_update.last_seen = datetime.utcnow()
                        cleanup_db.commit()
                        
                        # Broadcast offline status
                        await manager.broadcast_to_conversation(
                            {
                                "type": "user_offline",
                                "user_id": current_user.id,
                                "username": current_user.username
                            },
                            conversation_id=None,
                            participant_ids=list(manager.active_connections.keys())
                        )
                except SQLAlchemyError as e:
                    logger.error(f"Failed to update user offline status: {e}")
                    cleanup_db.rollback()
                finally:
                    cleanup_db.close()
            except Exception as e:
                logger.error(f"Error during WebSocket cleanup: {e}")
        
        # Close the main session
        try:
            db.close()
        except Exception as e:
            logger.error(f"Error closing WebSocket database session: {e}")