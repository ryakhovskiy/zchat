import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.main import app
from app.database import Base, get_db
from app.config import get_settings

# Test database
SQLALCHEMY_DATABASE_URL = "sqlite:///./test_auth.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Override settings for testing
settings = get_settings()
settings.SECRET_KEY = "test-secret-key"


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
    # Clean up after test
    Base.metadata.drop_all(bind=engine)


# Module-level client
client = TestClient(app)


class TestAuthentication:
    """Test authentication endpoints."""
    
    def test_register_user(self):
        """Test user registration."""
        response = client.post(
            "/api/auth/register",
            json={
                "username": "testuser",
                "password": "testpass123",
                "email": "test@example.com"
            }
        )
        assert response.status_code == 201
        data = response.json()
        assert "access_token" in data
        assert data["user"]["username"] == "testuser"
    
    def test_register_duplicate_username(self):
        """Test registration with duplicate username."""
        # First, register a user
        client.post(
            "/api/auth/register",
            json={
                "username": "testuser",
                "password": "testpass123"
            }
        )
        
        # Try to register again with same username
        response = client.post(
            "/api/auth/register",
            json={
                "username": "testuser",
                "password": "testpass123"
            }
        )
        assert response.status_code == 400
        assert "already registered" in response.json()["detail"].lower()
    
    def test_register_invalid_username(self):
        """Test registration with invalid username."""
        response = client.post(
            "/api/auth/register",
            json={
                "username": "ab",  # Too short
                "password": "testpass123"
            }
        )
        assert response.status_code == 422
    
    def test_login_success(self):
        """Test successful login."""
        # First, register a user
        client.post(
            "/api/auth/register",
            json={
                "username": "testuser",
                "password": "testpass123"
            }
        )
        
        # Now login
        response = client.post(
            "/api/auth/login",
            json={
                "username": "testuser",
                "password": "testpass123"
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"
    
    def test_login_wrong_password(self):
        """Test login with wrong password."""
        # First, register a user
        client.post(
            "/api/auth/register",
            json={
                "username": "testuser",
                "password": "testpass123"
            }
        )
        
        # Try to login with wrong password
        response = client.post(
            "/api/auth/login",
            json={
                "username": "testuser",
                "password": "wrongpassword"
            }
        )
        assert response.status_code == 401
    
    def test_login_nonexistent_user(self):
        """Test login with nonexistent user."""
        response = client.post(
            "/api/auth/login",
            json={
                "username": "nonexistent",
                "password": "password"
            }
        )
        assert response.status_code == 401
    
    def test_get_current_user(self):
        """Test getting current user info."""
        # First, register a user
        client.post(
            "/api/auth/register",
            json={
                "username": "testuser",
                "password": "testpass123"
            }
        )
        
        # Login to get token
        login_response = client.post(
            "/api/auth/login",
            json={
                "username": "testuser",
                "password": "testpass123"
            }
        )
        token = login_response.json()["access_token"]
        
        # Get current user
        response = client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["username"] == "testuser"
    
    def test_unauthorized_access(self):
        """Test accessing protected endpoint without token."""
        response = client.get("/api/auth/me")
        assert response.status_code == 403


# Cleanup
def teardown_module(module):
    """Cleanup after tests."""
    Base.metadata.drop_all(bind=engine)