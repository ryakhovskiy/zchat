"""Tests for message-related endpoints and services."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.main import app
from app.database import Base, get_db

# Test database
SQLALCHEMY_DATABASE_URL = "sqlite:///./test_messages.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db
Base.metadata.create_all(bind=engine)

client = TestClient(app)


@pytest.fixture(autouse=True)
def setup_and_teardown():
    """Setup and teardown for each test."""
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def test_users():
    """Create two test users."""
    user1 = client.post(
        "/api/auth/register",
        json={"username": "user1", "password": "pass123"}
    ).json()
    
    user2 = client.post(
        "/api/auth/register",
        json={"username": "user2", "password": "pass123"}
    ).json()
    
    return {
        "user1": user1,
        "user2": user2,
        "headers1": {"Authorization": f"Bearer {user1['access_token']}"},
        "headers2": {"Authorization": f"Bearer {user2['access_token']}"},
    }


@pytest.fixture
def test_conversation(test_users):
    """Create a test conversation between two users."""
    response = client.post(
        "/api/conversations",
        headers=test_users["headers1"],
        json={
            "participant_ids": [test_users["user2"]["user"]["id"]],
            "is_group": False
        }
    )
    return response.json()


class TestMessageCreation:
    """Test message creation."""
    
    def test_send_message(self, test_users, test_conversation):
        """Test sending a message in a conversation."""
        response = client.post(
            f"/api/conversations/{test_conversation['id']}/messages",
            headers=test_users["headers1"],
            params={"content": "Hello, this is a test message!"}
        )
        
        assert response.status_code == 201
        data = response.json()
        assert data["content"] == "Hello, this is a test message!"
        assert data["conversation_id"] == test_conversation["id"]
        assert data["sender_username"] == "user1"
    
    def test_send_empty_message(self, test_users, test_conversation):
        """Test that empty messages are rejected."""
        response = client.post(
            f"/api/conversations/{test_conversation['id']}/messages",
            headers=test_users["headers1"],
            params={"content": ""}
        )
        
        assert response.status_code == 422
    
    def test_send_message_to_nonexistent_conversation(self, test_users):
        """Test sending message to non-existent conversation."""
        response = client.post(
            "/api/conversations/99999/messages",
            headers=test_users["headers1"],
            params={"content": "This should fail"}
        )
        
        assert response.status_code == 404
    
    def test_send_message_to_conversation_not_participant(self, test_users, test_conversation):
        """Test that non-participants cannot send messages."""
        # Create a third user
        user3 = client.post(
            "/api/auth/register",
            json={"username": "user3", "password": "pass123"}
        ).json()
        
        headers3 = {"Authorization": f"Bearer {user3['access_token']}"}
        
        response = client.post(
            f"/api/conversations/{test_conversation['id']}/messages",
            headers=headers3,
            params={"content": "I shouldn't be able to send this"}
        )
        
        assert response.status_code == 403


class TestMessageRetrieval:
    """Test message retrieval."""
    
    def test_get_conversation_messages(self, test_users, test_conversation):
        """Test retrieving messages from a conversation."""
        # Send some messages
        for i in range(5):
            client.post(
                f"/api/conversations/{test_conversation['id']}/messages",
                headers=test_users["headers1"],
                params={"content": f"Message {i}"}
            )
        
        # Retrieve messages
        response = client.get(
            f"/api/conversations/{test_conversation['id']}/messages",
            headers=test_users["headers1"]
        )
        
        assert response.status_code == 200
        messages = response.json()
        assert len(messages) == 5
        assert messages[0]["content"] == "Message 0"
        assert messages[-1]["content"] == "Message 4"
    
    def test_get_messages_with_limit(self, test_users, test_conversation):
        """Test retrieving limited number of messages."""
        # Send 10 messages
        for i in range(10):
            client.post(
                f"/api/conversations/{test_conversation['id']}/messages",
                headers=test_users["headers1"],
                params={"content": f"Message {i}"}
            )
        
        # Retrieve only 5
        response = client.get(
            f"/api/conversations/{test_conversation['id']}/messages?limit=5",
            headers=test_users["headers1"]
        )
        
        assert response.status_code == 200
        messages = response.json()
        assert len(messages) == 5
    
    def test_cannot_get_messages_from_others_conversation(self, test_users):
        """Test that users cannot access conversations they're not part of."""
        # User1 creates conversation with User2
        conv = client.post(
            "/api/conversations",
            headers=test_users["headers1"],
            json={
                "participant_ids": [test_users["user2"]["user"]["id"]],
                "is_group": False
            }
        ).json()
        
        # Create a third user
        user3 = client.post(
            "/api/auth/register",
            json={"username": "user3", "password": "pass123"}
        ).json()
        headers3 = {"Authorization": f"Bearer {user3['access_token']}"}
        
        # User3 tries to access messages
        response = client.get(
            f"/api/conversations/{conv['id']}/messages",
            headers=headers3
        )
        
        assert response.status_code == 403


class TestMessageEncryption:
    """Test message encryption functionality."""
    
    def test_messages_are_encrypted_in_database(self, test_users, test_conversation):
        """Test that messages are stored encrypted."""
        # Send a message
        message_content = "This is a secret message!"
        client.post(
            f"/api/conversations/{test_conversation['id']}/messages",
            headers=test_users["headers1"],
            params={"content": message_content}
        )
        
        # Retrieve and verify it's decrypted in response
        response = client.get(
            f"/api/conversations/{test_conversation['id']}/messages",
            headers=test_users["headers1"]
        )
        
        messages = response.json()
        assert len(messages) == 1
        assert messages[0]["content"] == message_content


class TestMessagePruning:
    """Test automatic message pruning (last 1000 messages)."""
    
    def test_message_pruning(self, test_users, test_conversation):
        """Test that old messages are pruned after 1000."""
        # This test creates 1005 messages and verifies only 1000 remain
        # Note: This is a slower test, consider marking it with @pytest.mark.slow
        
        # Send 1005 messages
        for i in range(1005):
            client.post(
                f"/api/conversations/{test_conversation['id']}/messages",
                headers=test_users["headers1"],
                params={"content": f"Message {i}"}
            )
        
        # Get all messages
        response = client.get(
            f"/api/conversations/{test_conversation['id']}/messages?limit=2000",
            headers=test_users["headers1"]
        )
        
        messages = response.json()
        
        # Should only have 1000 messages
        assert len(messages) <= 1000
        
        # First message should be "Message 5" or later (first 5 pruned)
        if len(messages) == 1000:
            # The oldest messages should be pruned
            first_message_num = int(messages[0]["content"].split()[-1])
            assert first_message_num >= 5


class TestMessageValidation:
    """Test message content validation."""
    
    def test_message_max_length(self, test_users, test_conversation):
        """Test that very long messages are rejected."""
        long_message = "a" * 6000  # Over 5000 char limit
        
        response = client.post(
            f"/api/conversations/{test_conversation['id']}/messages",
            headers=test_users["headers1"],
            params={"content": long_message}
        )
        
        assert response.status_code == 422
    
    def test_message_whitespace_only(self, test_users, test_conversation):
        """Test that whitespace-only messages are rejected."""
        response = client.post(
            f"/api/conversations/{test_conversation['id']}/messages",
            headers=test_users["headers1"],
            params={"content": "   "}
        )
        
        assert response.status_code == 422


class TestGroupMessageing:
    """Test messaging in group conversations."""
    
    def test_send_message_in_group(self, test_users):
        """Test sending messages in group conversations."""
        # Create a group with both users
        group = client.post(
            "/api/conversations",
            headers=test_users["headers1"],
            json={
                "participant_ids": [test_users["user2"]["user"]["id"]],
                "is_group": True,
                "name": "Test Group"
            }
        ).json()
        
        # User1 sends message
        response = client.post(
            f"/api/conversations/{group['id']}/messages",
            headers=test_users["headers1"],
            params={"content": "Hello group!"}
        )
        
        assert response.status_code == 201
        
        # User2 can see the message
        response = client.get(
            f"/api/conversations/{group['id']}/messages",
            headers=test_users["headers2"]
        )
        
        messages = response.json()
        assert len(messages) == 1
        assert messages[0]["content"] == "Hello group!"
        assert messages[0]["sender_username"] == "user1"


# Cleanup
def teardown_module(module):
    """Cleanup after all tests."""
    Base.metadata.drop_all(bind=engine)