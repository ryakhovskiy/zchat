import sys
import os
from sqlalchemy import text

# Add backend directory to path so we can import app modules
# We are in backend/scripts, need to import from backend
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import engine

def migrate():
    print("Starting migration: Adding is_read column to messages table...")
    
    with engine.connect() as connection:
        try:
            # Using text() for execution
            statement = text("ALTER TABLE messages ADD COLUMN is_read BOOLEAN DEFAULT FALSE")
            connection.execute(statement)
            connection.commit()
            print("Successfully added is_read column.")
        except Exception as e:
            # If the column already exists, this might fail.
            print(f"Migration failed (might already exist): {e}")

if __name__ == "__main__":
    migrate()
