from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, Query
from sqlalchemy.orm import Session
from typing import Dict
from datetime import datetime
import json
from app.database import get_db
from app.models.user import User
from app.schemas import MessageCreate, WSMessage
from app.services.message_service import MessageService
from app.utils.security import decode_token

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
            except:
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
    token: str = Query(...),
    db: Session = Depends(get_db)
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
    try:
        # Authenticate user
        current_user = await get_current_user_ws(token, db)
        
        # Connect
        await manager.connect(current_user.id, websocket)
        
        # Mark user as online
        current_user.is_online = True
        db.commit()
        
        # Broadcast online status
        await manager.broadcast_to_conversation(
            {
                "type": "user_online",
                "user_id": current_user.id,
                "username": current_user.username
            },
            conversation_id=None,
            participant_ids=[conn_id for conn_id in manager.active_connections.keys()]
        )
        
        try:
            while True:
                # Receive message
                data = await websocket.receive_json()
                
                if data.get("type") == "message":
                    # Create and save message
                    message_data = MessageCreate(
                        content=data["content"],
                        conversation_id=data["conversation_id"]
                    )
                    
                    message_response = MessageService.create_message(
                        db, message_data, current_user
                    )
                    
                    # Get conversation participants
                    from app.models.conversation import Conversation
                    conversation = db.query(Conversation).filter(
                        Conversation.id == data["conversation_id"]
                    ).first()
                    
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
                
                elif data.get("type") == "typing":
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
        
        except WebSocketDisconnect:
            pass
    
    except Exception as e:
        if websocket.client_state.name == "CONNECTED":
            await websocket.close(code=1008)
        return
    
    finally:
        # Cleanup
        manager.disconnect(current_user.id)
        
        # Mark user as offline
        current_user.is_online = False
        current_user.last_seen = datetime.utcnow()
        db.commit()
        
        # Broadcast offline status
        await manager.broadcast_to_conversation(
            {
                "type": "user_offline",
                "user_id": current_user.id,
                "username": current_user.username
            },
            conversation_id=None,
            participant_ids=[conn_id for conn_id in manager.active_connections.keys()]
        )