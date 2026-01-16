from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.schemas import UserCreate, UserLogin, Token, UserResponse
from app.services.auth_service import AuthService
from app.utils.security import get_current_user
from app.models.user import User

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/register", response_model=Token, status_code=status.HTTP_201_CREATED)
async def register(
    user_data: UserCreate,
    db: Session = Depends(get_db)
):
    """
    Register a new user.
    
    - **username**: Unique username (3-50 chars, alphanumeric)
    - **password**: Password (min 6 chars)
    - **email**: Optional email address
    """
    user = AuthService.register_user(db, user_data)
    
    # Auto-login after registration
    login_data = UserLogin(username=user_data.username, password=user_data.password)
    return AuthService.authenticate_user(db, login_data)


@router.post("/login", response_model=Token)
async def login(
    credentials: UserLogin,
    db: Session = Depends(get_db)
):
    """
    Authenticate user and receive access token.
    
    - **username**: Your username
    - **password**: Your password
    """
    return AuthService.authenticate_user(db, credentials)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Logout current user (mark as offline).
    """
    AuthService.logout_user(db, current_user)
    return None


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(
    current_user: User = Depends(get_current_user)
):
    """
    Get current authenticated user information.
    """
    return UserResponse.from_orm(current_user)