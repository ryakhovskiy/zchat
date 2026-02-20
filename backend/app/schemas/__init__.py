"""Aggregate schema exports for convenience."""

from .user import (
    UserBase,
    UserCreate,
    UserLogin,
    UserUpdate,
    UserResponse,
    UserPublic,
    Token,
    TokenData,
)

from .message import (
    MessageBase,
    MessageCreate,
    MessageEdit,
    MessageDelete,
    MessageUpdate,
    MessageResponse,
    MessageWithSender,
    WSMessage,
)

from .conversation import (
    ConversationBase,
    ConversationCreate,
    ConversationUpdate,
    ConversationResponse,
    ConversationList,
    ConversationWithMessages,
)

__all__ = [
    "UserBase",
    "UserCreate",
    "UserLogin",
    "UserUpdate",
    "UserResponse",
    "UserPublic",
    "Token",
    "TokenData",
    "MessageBase",
    "MessageCreate",
    "MessageUpdate",
    "MessageResponse",
    "MessageWithSender",
    "WSMessage",
    "ConversationBase",
    "ConversationCreate",
    "ConversationUpdate",
    "ConversationResponse",
    "ConversationList",
    "ConversationWithMessages",
]