# Database Initialization

This directory contains SQL files for database schema definition.

## Files

- **users.sql** - Users table with authentication and profile data
- **conversations.sql** - Conversations table for direct and group chats
- **conversation_participants.sql** - Junction table linking users to conversations
- **messages.sql** - Messages table with encrypted content
- **indexes.sql** - Database indexes for query optimization

## Table Creation Order

Tables are created in the following order to respect foreign key constraints:

1. `users` - No dependencies
2. `conversations` - No dependencies
3. `conversation_participants` - References users and conversations
4. `messages` - References conversations and users

## How It Works

The `DatabaseInitializer` class in `app/db_init.py`:

1. Checks if the database file exists (creates if not)
2. For each SQL file, checks if the table exists
3. Creates tables only if they don't exist
4. Creates indexes for query optimization
5. Enables foreign key constraints for SQLite

## Usage

The database is automatically initialized on application startup in `app/main.py`.

To manually test initialization:
```bash
python test_db_init.py
```

To reset the database (drops all tables and recreates):
```python
from app.db_init import DatabaseInitializer

initializer = DatabaseInitializer()
initializer.reset_database()  # ⚠️ This will delete all data!
```
