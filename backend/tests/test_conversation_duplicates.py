"""Tests for conversation duplicate prevention."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.main import app
from app.database import Base, get_db

# Test database - unique to this test file
SQLALCHEMY_DATABASE_URL = "sqlite:///./test_conversation_duplicates.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


# Create tables initially
Base.metadata.create_all(bind=engine)


@pytest.fixture(autouse=True)
def setup_and_teardown():
    """Setup and teardown for each test."""
    # Set the override for THIS test module's database
    app.dependency_overrides[get_db] = override_get_db
    
    # Drop and recreate to ensure clean state
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    
    yield
    
    # Clean up: drop all tables
    Base.metadata.drop_all(bind=engine)


# Module-level client - uses the database set up by setup_and_teardown fixture
client = TestClient(app)


@pytest.fixture(scope="function")
def test_users():
    """Create multiple test users."""
    users = []
    headers = []
    
    for i in range(5):
        response = client.post(
            "/api/auth/register",
            json={"username": f"user{i+1}", "password": "pass123"}
        )
        assert response.status_code == 201, f"Failed to create user{i+1}: {response.json()}"
        user_data = response.json()
        users.append(user_data)
        headers.append({"Authorization": f"Bearer {user_data['access_token']}"})
    
    return {
        "users": users,
        "headers": headers,
    }


class TestDirectConversationDuplicates:
    """Test that duplicate 1:1 conversations are prevented."""
    
    def test_create_duplicate_direct_conversation_returns_existing(self, test_users):
        """Test that creating a duplicate 1:1 conversation returns the existing one."""
        user1_id = test_users["users"][0]["user"]["id"]
        user2_id = test_users["users"][1]["user"]["id"]
        
        # Create first conversation between user1 and user2
        response1 = client.post(
            "/api/conversations",
            headers=test_users["headers"][0],
            json={
                "participant_ids": [user2_id],
                "is_group": False
            }
        )
        assert response1.status_code == 201
        conv1 = response1.json()
        
        # Try to create the same conversation again from user1
        response2 = client.post(
            "/api/conversations",
            headers=test_users["headers"][0],
            json={
                "participant_ids": [user2_id],
                "is_group": False
            }
        )
        assert response2.status_code == 201
        conv2 = response2.json()
        
        # Should return the same conversation
        assert conv1["id"] == conv2["id"], "Should return existing conversation, not create new one"
    
    def test_create_duplicate_direct_conversation_from_other_user(self, test_users):
        """Test that the other participant creating the same conversation gets the existing one."""
        user1_id = test_users["users"][0]["user"]["id"]
        user2_id = test_users["users"][1]["user"]["id"]
        
        # User1 creates conversation with User2
        response1 = client.post(
            "/api/conversations",
            headers=test_users["headers"][0],
            json={
                "participant_ids": [user2_id],
                "is_group": False
            }
        )
        assert response1.status_code == 201
        conv1 = response1.json()
        
        # User2 tries to create conversation with User1
        response2 = client.post(
            "/api/conversations",
            headers=test_users["headers"][1],
            json={
                "participant_ids": [user1_id],
                "is_group": False
            }
        )
        assert response2.status_code == 201
        conv2 = response2.json()
        
        # Should return the same conversation (order doesn't matter)
        assert conv1["id"] == conv2["id"], "Should return existing conversation regardless of who initiates"
    
    def test_different_direct_conversations_are_separate(self, test_users):
        """Test that conversations with different users are kept separate."""
        user1_id = test_users["users"][0]["user"]["id"]
        user2_id = test_users["users"][1]["user"]["id"]
        user3_id = test_users["users"][2]["user"]["id"]
        
        # User1 creates conversation with User2
        response1 = client.post(
            "/api/conversations",
            headers=test_users["headers"][0],
            json={
                "participant_ids": [user2_id],
                "is_group": False
            }
        )
        assert response1.status_code == 201
        conv1 = response1.json()
        
        # User1 creates conversation with User3
        response2 = client.post(
            "/api/conversations",
            headers=test_users["headers"][0],
            json={
                "participant_ids": [user3_id],
                "is_group": False
            }
        )
        assert response2.status_code == 201
        conv2 = response2.json()
        
        # Should be different conversations
        assert conv1["id"] != conv2["id"], "Different users should have different conversations"


class TestGroupConversationDuplicates:
    """Test that duplicate group conversations are prevented."""
    
    def test_create_duplicate_group_conversation_returns_existing(self, test_users):
        """Test that creating a duplicate group conversation returns the existing one."""
        user1_id = test_users["users"][0]["user"]["id"]
        user2_id = test_users["users"][1]["user"]["id"]
        user3_id = test_users["users"][2]["user"]["id"]
        
        # Create first group conversation
        response1 = client.post(
            "/api/conversations",
            headers=test_users["headers"][0],
            json={
                "participant_ids": [user2_id, user3_id],
                "is_group": True,
                "name": "Test Group"
            }
        )
        assert response1.status_code == 201
        conv1 = response1.json()
        
        # Try to create the same group conversation again
        response2 = client.post(
            "/api/conversations",
            headers=test_users["headers"][0],
            json={
                "participant_ids": [user2_id, user3_id],
                "is_group": True,
                "name": "Another Test Group"
            }
        )
        assert response2.status_code == 201
        conv2 = response2.json()
        
        # Should return the same conversation
        assert conv1["id"] == conv2["id"], "Should return existing group conversation"
    
    def test_group_conversation_participant_order_doesnt_matter(self, test_users):
        """Test that participant order doesn't affect duplicate detection."""
        user1_id = test_users["users"][0]["user"]["id"]
        user2_id = test_users["users"][1]["user"]["id"]
        user3_id = test_users["users"][2]["user"]["id"]
        
        # Create group with participants in one order
        response1 = client.post(
            "/api/conversations",
            headers=test_users["headers"][0],
            json={
                "participant_ids": [user2_id, user3_id],
                "is_group": True,
                "name": "Group A"
            }
        )
        assert response1.status_code == 201
        conv1 = response1.json()
        
        # Try to create with participants in different order
        response2 = client.post(
            "/api/conversations",
            headers=test_users["headers"][1],
            json={
                "participant_ids": [user3_id, user1_id],
                "is_group": True,
                "name": "Group B"
            }
        )
        assert response2.status_code == 201
        conv2 = response2.json()
        
        # Should return the same conversation
        assert conv1["id"] == conv2["id"], "Participant order should not matter for duplicate detection"
    
    def test_different_group_compositions_are_separate(self, test_users):
        """Test that groups with different participants are kept separate."""
        user1_id = test_users["users"][0]["user"]["id"]
        user2_id = test_users["users"][1]["user"]["id"]
        user3_id = test_users["users"][2]["user"]["id"]
        user4_id = test_users["users"][3]["user"]["id"]
        
        # Create group with user1, user2, user3
        response1 = client.post(
            "/api/conversations",
            headers=test_users["headers"][0],
            json={
                "participant_ids": [user2_id, user3_id],
                "is_group": True,
                "name": "Group 1"
            }
        )
        assert response1.status_code == 201
        conv1 = response1.json()
        
        # Create group with user1, user2, user4 (different participant)
        response2 = client.post(
            "/api/conversations",
            headers=test_users["headers"][0],
            json={
                "participant_ids": [user2_id, user4_id],
                "is_group": True,
                "name": "Group 2"
            }
        )
        assert response2.status_code == 201
        conv2 = response2.json()
        
        # Should be different conversations
        assert conv1["id"] != conv2["id"], "Different participant sets should create different conversations"
    
    def test_group_with_subset_of_participants_is_separate(self, test_users):
        """Test that a group with a subset of participants is a separate conversation."""
        user1_id = test_users["users"][0]["user"]["id"]
        user2_id = test_users["users"][1]["user"]["id"]
        user3_id = test_users["users"][2]["user"]["id"]
        
        # Create group with user1, user2, user3
        response1 = client.post(
            "/api/conversations",
            headers=test_users["headers"][0],
            json={
                "participant_ids": [user2_id, user3_id],
                "is_group": True,
                "name": "Full Group"
            }
        )
        assert response1.status_code == 201
        conv1 = response1.json()
        
        # Create group with only user1, user2
        response2 = client.post(
            "/api/conversations",
            headers=test_users["headers"][0],
            json={
                "participant_ids": [user2_id],
                "is_group": True,
                "name": "Subset Group"
            }
        )
        assert response2.status_code == 201
        conv2 = response2.json()
        
        # Should be different conversations
        assert conv1["id"] != conv2["id"], "Subset of participants should create separate conversation"


class TestConversationCount:
    """Test that no duplicate conversations are created in the database."""
    
    def test_total_conversation_count_after_duplicates(self, test_users):
        """Test that attempting to create duplicates doesn't increase conversation count."""
        user1_id = test_users["users"][0]["user"]["id"]
        user2_id = test_users["users"][1]["user"]["id"]
        
        # Create initial conversation
        client.post(
            "/api/conversations",
            headers=test_users["headers"][0],
            json={"participant_ids": [user2_id], "is_group": False}
        )
        
        # Get conversation list - should have 1
        response1 = client.get(
            "/api/conversations",
            headers=test_users["headers"][0]
        )
        assert len(response1.json()) == 1
        
        # Try to create duplicate
        client.post(
            "/api/conversations",
            headers=test_users["headers"][0],
            json={"participant_ids": [user2_id], "is_group": False}
        )
        
        # Get conversation list - should still have 1
        response2 = client.get(
            "/api/conversations",
            headers=test_users["headers"][0]
        )
        assert len(response2.json()) == 1, "Duplicate creation should not increase conversation count"
