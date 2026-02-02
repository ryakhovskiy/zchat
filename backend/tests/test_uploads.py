import pytest
import os
import shutil
from pathlib import Path

# Helper to get auth headers
def get_auth_headers(client, username="testuploader", email="uploader@example.com", password="password123"):
    # Try login first
    login_res = client.post("/api/auth/login", json={
        "username": username,
        "password": password
    })
    
    if login_res.status_code != 200:
        # Register if login fails
        client.post("/api/auth/register", json={
            "username": username,
            "email": email,
            "password": password
        })
        login_res = client.post("/api/auth/login", json={
            "username": username,
            "password": password
        })
    
    token = login_res.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}

def test_upload_image_flow(client):
    headers = get_auth_headers(client)
    
    # Create dummy image content
    file_content = b"fakeimagecontent"
    filename = "test_image.png"
    files = {
        "file": (filename, file_content, "image/png")
    }
    
    # Upload
    response = client.post("/api/uploads/", files=files, headers=headers)
    assert response.status_code == 200
    data = response.json()
    
    assert "file_path" in data
    assert "filename" in data
    assert data["file_type"] == "image"
    
    file_path = data["file_path"]
    server_filename = data["filename"]
    
    # Verify file exists
    assert os.path.exists(file_path)
    
    # Clean up file
    try:
        os.remove(file_path)
    except:
        pass

def test_upload_document_flow(client):
    headers = get_auth_headers(client, "docuser", "doc@example.com")
    
    file_content = b"This is a pdf document"
    filename = "test_doc.pdf"
    files = {
        "file": (filename, file_content, "application/pdf")
    }
    
    response = client.post("/api/uploads/", files=files, headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["file_type"] == "document"
    
    # Clean up
    if os.path.exists(data["file_path"]):
        os.remove(data["file_path"])

def test_upload_invalid_type(client):
    headers = get_auth_headers(client, "baduser", "bad@example.com")
    
    files = {
        "file": ("malicious.exe", b"binary", "application/octet-stream")
    }
    
    response = client.post("/api/uploads/", files=files, headers=headers)
    assert response.status_code == 400

def test_send_message_with_file(client):
    headers = get_auth_headers(client, "msguser", "msg@example.com")
    
    # 1. Create a conversation
    # We need another user to create a conversation
    client.post("/api/auth/register", json={
        "username": "otheruser",
        "email": "other@example.com",
        "password": "password123"
    })
    
    # Get ID of other user (hacky way, listing users or just assuming ID check)
    # Let's just create a group chat to be simpler or direct chat if we knew ID.
    # I'll create conversational by getting users.
    
    users_res = client.get("/api/users/", headers=headers)
    other_user = next(u for u in users_res.json() if u["username"] == "otheruser")
    
    conv_res = client.post("/api/conversations/", json={
        "participant_ids": [other_user["id"]],
        "is_group": False
    }, headers=headers)
    conv_id = conv_res.json()["id"]
    
    # 2. Upload file
    files = {"file": ("t.png", b"x", "image/png")}
    up_res = client.post("/api/uploads/", files=files, headers=headers)
    file_data = up_res.json()
    
    # 3. Send message with file info
    # Note: We need to include conversation_id in body because MessageCreate schema requires it
    msg_res = client.post(f"/api/conversations/{conv_id}/messages", json={
        "conversation_id": conv_id, 
        "content": "Image attached", 
        "file_path": file_data["file_path"],
        "file_type": file_data["file_type"]
    }, headers=headers)
    
    assert msg_res.status_code == 201, f"Failed: {msg_res.text}"
    msg = msg_res.json()
    assert msg["file_path"] == file_data["file_path"]
    assert msg["file_type"] == "image"
    
    # Clean up
    if os.path.exists(file_data["file_path"]):
        os.remove(file_data["file_path"])
