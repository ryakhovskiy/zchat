import os
import shutil
import uuid
from pathlib import Path
from typing import List
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from app.database import get_db
from app.utils.security import get_current_user, decode_token
from app.models.user import User

router = APIRouter(prefix="/uploads", tags=["Uploads"])

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_EXTENSIONS = {
    'image': ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'],
    'document': ['.pdf', '.doc', '.docx', '.txt', '.xls', '.xlsx', '.ppt', '.pptx', '.csv', '.rtf', '.odt'],
    'archive': ['.zip', '.rar', '.7z', '.tar', '.gz'],
    'audio': ['.mp3', '.wav', '.ogg', '.m4a'],
    'video': ['.mp4', '.avi', '.mov', '.webm', '.mkv']
}

FORBIDDEN_EXTENSIONS = {
    '.exe', '.dll', '.bat', '.cmd', '.sh', '.cgi', '.jar', '.js', '.vbs', 
    '.ps1', '.py', '.php', '.msi', '.com', '.scr', '.pif', '.reg', '.app',
    '.bin', '.wsf', '.vb', '.iso', '.dmg', '.pkg'
}

MAX_UPLOAD_SIZE = 50 * 1024 * 1024  # 50MB

@router.post("/", response_model=dict)
async def upload_file(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user)
):
    """Upload a file (image or document)."""
    # Validate extension
    ext = Path(file.filename).suffix.lower()
    
    if ext in FORBIDDEN_EXTENSIONS:
         raise HTTPException(400, "File type not allowed (executable/installer)")
    
    file_type = 'file' # Default type
    
    if ext in ALLOWED_EXTENSIONS['image']:
        file_type = 'image'
    elif ext in ALLOWED_EXTENSIONS['document']:
        file_type = 'document'
    elif ext in ALLOWED_EXTENSIONS['video']:
        file_type = 'video'
    elif ext in ALLOWED_EXTENSIONS['audio']:
        file_type = 'audio'
    elif ext in ALLOWED_EXTENSIONS['archive']:
        file_type = 'archive'
    
    # Generate unique filename
    filename = f"{uuid.uuid4()}{ext}"
    file_path = UPLOAD_DIR / filename
    
    try:
        size = 0
        with file_path.open("wb") as buffer:
            while True:
                chunk = await file.read(1024 * 1024)  # Read 1MB chunks
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_UPLOAD_SIZE:
                    buffer.close()
                    file_path.unlink()  # Delete partial file
                    raise HTTPException(413, "File too large (max 50MB)")
                buffer.write(chunk)
    except HTTPException:
        raise
    except Exception as e:
        if file_path.exists():
            file_path.unlink()
        raise HTTPException(500, f"Could not save file: {e}")
        
    return {
        "file_path": str(file_path),
        "file_type": file_type,
        "filename": filename
    }

@router.get("/{filename}")
async def get_file(
    filename: str,
    token: str = Query(...),
    db: Session = Depends(get_db)
):
    """Serve an uploaded file."""
    # Verify token
    try:
        payload = decode_token(token)
        username = payload.get("sub")
        if not username:
            raise HTTPException(401, "Invalid token")
            
        user = db.query(User).filter(User.username == username).first()
        if not user:
            raise HTTPException(401, "User not found")
    except Exception:
        raise HTTPException(401, "Invalid token")
    
    file_path = UPLOAD_DIR / filename
    if not file_path.exists():
        raise HTTPException(404, "File not found")
        
    return FileResponse(file_path)
