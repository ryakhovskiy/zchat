"""
Zchat Application Backend
"""

__version__ = "1.0.0"
__author__ = "Konstantin Ryakhovskiy"
__license__ = "MIT"

"""API route handlers."""

from app.api import auth, users, conversations, websocket

__all__ = [
    "auth",
    "users",
    "conversations",
    "websocket",
]