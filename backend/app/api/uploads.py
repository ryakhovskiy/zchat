import os
import shutil
import uuid
from pathlib import Path
from typing import List
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from fastapi.responses import FileResponse
from app.utils.security import get_current_user
from app.models.user import User

router = APIRouter(prefix="/uploads", tags=["Uploads"])

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_EXTENSIONS = {
    'image': ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
    'document': ['.pdf', '.doc', '.docx', '.txt', '.xls', '.xlsx']
}

@router.post("/", response_model=dict)
async def upload_file(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user)
):
    """Upload a file (image or document)."""
    # Validate extension
    ext = Path(file.filename).suffix.lower()
    file_type = None
    
    if ext in ALLOWED_EXTENSIONS['image']:
        file_type = 'image'
    elif ext in ALLOWED_EXTENSIONS['document']:
        file_type = 'document'
    else:
        raise HTTPException(400, "File type not allowed")
    
    # Generate unique filename
    filename = f"{uuid.uuid4()}{ext}"
    file_path = UPLOAD_DIR / filename
    
    try:
        with file_path.open("wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        raise HTTPException(500, f"Could not save file: {e}")
        
    return {
        "file_path": str(file_path),
        "file_type": file_type,
        "filename": filename
    }

@router.get("/{filename}")
async def get_file(
    filename: str,
    current_user: User = Depends(get_current_user)
):
    """Serve an uploaded file."""
    # In a real app, you should check if the user has access to the conversation 
    # where this file was sent. For now, we just check if they are authenticated.
    
    file_path = UPLOAD_DIR / filename
    if not file_path.exists():
        raise HTTPException(404, "File not found")
        
    return FileResponse(file_path)
