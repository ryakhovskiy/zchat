import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_send_message():
    # Add test implementation
    pass

def test_get_messages():
    # Add test implementation
    pass
