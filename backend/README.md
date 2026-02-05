# zChat Application Backend

FastAPI-based backend for a real-time zChat application.

## Setup

1. Install dependencies:
```bash
uv sync
```

2. Copy `.env.example` to `.env` and configure:
```bash
cp .env.example .env
```

3. Initialize the database:
```bash
python scripts/db_manager.py init
```

4. Run the application:
```bash
uvicorn app.main:app --reload
```

## Database Management

Use the `db_manager.py` script for database operations:

```bash
# Initialize database (create tables and indexes)
python scripts/db_manager.py init

# Inspect database schema
python scripts/db_manager.py inspect

# Reset database (drops all tables and recreates)
python scripts/db_manager.py reset
```

See [scripts/README.md](scripts/README.md) for more details.

## API Documentation

Access the interactive API documentation at:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## Testing

Run tests with:
```bash
pytest
```
