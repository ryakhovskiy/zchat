from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    """Application configuration using environment variables."""
    
    # Application
    APP_NAME: str = "zChat Application"
    DEBUG: bool = False
    
    # Security
    SECRET_KEY: str = "your-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24 hours
    REMEMBER_ME_TOKEN_EXPIRE_DAYS: int = 30  # 30 days for "Remember Me"
    
    # Database
    DATABASE_URL: str = "sqlite:///./zchat.db"
    ENCRYPTION_KEY: str = "your-encryption-key-change-in-production"  # Must be 32 bytes base64
    
    # CORS
    CORS_ORIGINS: list = ["http://localhost:3000", "http://localhost:5173"]
    
    # Message limits
    MAX_MESSAGES_PER_CONVERSATION: int = 1000
    
    class Config:
        env_file = ".env"
        case_sensitive = True


@lru_cache()
def get_settings() -> Settings:
    """Return cached settings instance."""
    return Settings()