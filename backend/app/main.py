from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import get_settings
from app.database import init_db
from app.api import auth, users, conversations, websocket

settings = get_settings()

# Initialize FastAPI app
app = FastAPI(
    title=settings.APP_NAME,
    description="Zchat with real-time messaging",
    version="1.0.0"
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(conversations.router, prefix="/api")
app.include_router(websocket.router)


@app.on_event("startup")
async def startup_event():
    """Initialize database on startup."""
    init_db()
    print("✓ Database initialized")
    print(f"✓ Server running on http://localhost:8000")
    print(f"✓ API docs available at http://localhost:8000/docs")


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "message": "Chat Application API",
        "version": "1.0.0",
        "docs": "/docs"
    }


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.DEBUG

    )
