"""Tests for user-related endpoints and services."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.main import app
from app.database import Base, get_db
from app.models.user import User
from app.utils.security import get_password_hash

# Test database
SQLALCHEMY_DATABASE_URL = "sqlite:///./test_users.db"
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
    # Setup: Create tables
    Base.metadata.create_all(bind=engine)
    yield
    # Teardown: Drop all tables
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def test_user():
    """Create a test user and return credentials."""
    response = client.post(
        "/api/auth/register",
        json={
            "username": "testuser",
            "password": "testpass123",
            "email": "test@example.com"
        }
    )
    return response.json()


@pytest.fixture
def auth_headers(test_user):
    """Get authentication headers for test user."""
    token = test_user["access_token"]
    return {"Authorization": f"Bearer {token}"}


class TestUserEndpoints:
    """Test user-related endpoints."""
    
    def test_get_all_users(self, auth_headers):
        """Test getting all users."""
        response = client.get("/api/users", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 1
        assert data[0]["username"] == "testuser"
    
    def test_get_all_users_unauthorized(self):
        """Test getting users without authentication."""
        response = client.get("/api/users")
        assert response.status_code == 403
    
    def test_get_online_users(self, auth_headers):
        """Test getting online users."""
        response = client.get("/api/users/online", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        # Test user should be online after login
        assert any(user["username"] == "testuser" for user in data)
    
    def test_get_user_by_id(self, auth_headers, test_user):
        """Test getting specific user by ID."""
        user_id = test_user["user"]["id"]
        response = client.get(f"/api/users/{user_id}", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == user_id
        assert data["username"] == "testuser"
    
    def test_get_nonexistent_user(self, auth_headers):
        """Test getting user that doesn't exist."""
        response = client.get("/api/users/99999", headers=auth_headers)
        assert response.status_code == 404
    
    def test_multiple_users_online(self):
        """Test multiple users showing as online."""
        # Create first user
        user1 = client.post(
            "/api/auth/register",
            json={"username": "user1", "password": "pass123"}
        ).json()
        
        # Create second user
        user2 = client.post(
            "/api/auth/register",
            json={"username": "user2", "password": "pass123"}
        ).json()
        
        # Get online users
        headers = {"Authorization": f"Bearer {user1['access_token']}"}
        response = client.get("/api/users/online", headers=headers)
        
        assert response.status_code == 200
        online_users = response.json()
        assert len(online_users) >= 2
        
        usernames = [u["username"] for u in online_users]
        assert "user1" in usernames
        assert "user2" in usernames


class TestUserService:
    """Test user service functions."""
    
    def test_user_appears_in_list(self, auth_headers):
        """Test that created user appears in user list."""
        # Create another user
        client.post(
            "/api/auth/register",
            json={"username": "anotheruser", "password": "pass123"}
        )
        
        # Get all users
        response = client.get("/api/users", headers=auth_headers)
        users = response.json()
        
        usernames = [u["username"] for u in users]
        assert "testuser" in usernames
        assert "anotheruser" in usernames
    
    def test_user_online_status(self, test_user):
        """Test user online status tracking."""
        headers = {"Authorization": f"Bearer {test_user['access_token']}"}
        
        # Get current user info
        response = client.get("/api/auth/me", headers=headers)
        user_data = response.json()
        
        assert user_data["is_online"] == True
        
        # Logout
        client.post("/api/auth/logout", headers=headers)
        
        # Check online users - should not include logged out user
        new_user = client.post(
            "/api/auth/register",
            json={"username": "newuser", "password": "pass123"}
        ).json()
        
        new_headers = {"Authorization": f"Bearer {new_user['access_token']}"}
        response = client.get("/api/users/online", headers=new_headers)
        online_users = response.json()
        
        # Original user should not be in online list
        assert not any(u["username"] == "testuser" for u in online_users)


class TestUserValidation:
    """Test user input validation."""
    
    def test_username_too_short(self):
        """Test registration with too short username."""
        response = client.post(
            "/api/auth/register",
            json={"username": "ab", "password": "pass123"}
        )
        assert response.status_code == 422
    
    def test_username_special_characters(self):
        """Test username with special characters."""
        response = client.post(
            "/api/auth/register",
            json={"username": "user@name", "password": "pass123"}
        )
        assert response.status_code == 422
    
    def test_valid_username_with_underscore(self):
        """Test that underscores are allowed in usernames."""
        response = client.post(
            "/api/auth/register",
            json={"username": "user_name", "password": "pass123"}
        )
        assert response.status_code == 201
    
    def test_valid_username_with_hyphen(self):
        """Test that hyphens are allowed in usernames."""
        response = client.post(
            "/api/auth/register",
            json={"username": "user-name", "password": "pass123"}
        )
        assert response.status_code == 201


# Cleanup
def teardown_module(module):
    """Cleanup after all tests."""
    Base.metadata.drop_all(bind=engine)