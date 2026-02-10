import logging
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.encoders import jsonable_encoder
from app.config import get_settings
from app.db_init import init_database
from app.api import auth, users, conversations, websocket, uploads, browser

logger = logging.getLogger(__name__)
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

# Add custom exception handler for validation errors
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Log and handle validation errors with detailed information."""
    body_bytes = await request.body()
    try:
        body_text = body_bytes.decode("utf-8")
    except UnicodeDecodeError:
        body_text = str(body_bytes)

    errors = exc.errors()
    logger.error(f"Validation error on {request.method} {request.url.path}")
    logger.error(f"Request body: {body_text}")
    logger.error(f"Validation errors: {errors}")

    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "detail": jsonable_encoder(errors),
            "body": jsonable_encoder(getattr(exc, "body", body_text))
        }
    )

# Include routers
app.include_router(auth.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(conversations.router, prefix="/api")
app.include_router(uploads.router, prefix="/api")
app.include_router(browser.router, prefix="/api/browser", tags=["Browser"])
app.include_router(websocket.router)


@app.on_event("startup")
async def startup_event():
    """Initialize database on startup."""
    print("=" * 60)
    print("Starting zChat Application")
    print("=" * 60)
    init_database()
    print("=" * 60)
    print(f"✓ Server running on http://localhost:8000")
    print(f"✓ API docs available at http://localhost:8000/docs")
    print("=" * 60)


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "message": "zChat Application API",
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
