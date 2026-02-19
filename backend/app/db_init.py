"""Database initialization using raw SQL queries with PostgreSQL."""
import logging
import os
import sys
import time
from pathlib import Path
from typing import List

# Add the parent directory to sys.path to resolve 'app' module
sys.path.append(str(Path(__file__).resolve().parent.parent))

import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT
from app.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)

class DatabaseInitializer:
    """Initialize database using SQL files from app/sql directory."""
    
    def __init__(self):
        self.sql_dir = Path(__file__).parent / "sql"
        # Order matters: create tables with no foreign keys first
        self.table_files = [
            "users.sql",
            "conversations.sql",
            "conversation_participants.sql",
            "messages.sql"
        ]
        self.index_file = "indexes.sql"
        self.max_retries = 30
        self.retry_interval = 2

    def _get_db_connection(self):
        """Create a connection to the PostgreSQL database."""
        # Simple parsing of DATABASE_URL
        # postgresql://user:password@host:port/dbname
        try:
            return psycopg2.connect(settings.DATABASE_URL)
        except Exception as e:
            logger.error(f"Error connecting to database: {e}")
            raise

    def wait_for_db(self):
        """Wait for database to be ready."""
        logger.info("Waiting for database connection...")
        for i in range(self.max_retries):
            try:
                conn = self._get_db_connection()
                conn.close()
                logger.info("Database connection successful")
                return
            except Exception:
                if i < self.max_retries - 1:
                    time.sleep(self.retry_interval)
                    logger.info(f"Retrying database connection ({i + 1}/{self.max_retries})...")
                else:
                    logger.error("Could not connect to database after multiple retries")
                    raise Exception("Database connection failed")

    def initialize(self):
        """Run database initialization."""
        self.wait_for_db()
        
        conn = self._get_db_connection()
        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        cursor = conn.cursor()
        
        try:
            # Create tables
            for sql_file in self.table_files:
                self._execute_sql_file(cursor, sql_file)
            
            # Create indexes
            if self.index_file:
                 self._execute_sql_file(cursor, self.index_file)
                 
            logger.info("Database initialization completed successfully")
            
        except Exception as e:
            logger.error(f"Database initialization failed: {e}")
            raise
        finally:
            cursor.close()
            conn.close()

    def _execute_sql_file(self, cursor, filename: str):
        """Execute SQL statements from a file."""
        file_path = self.sql_dir / filename
        if not file_path.exists():
            logger.warning(f"SQL file not found: {filename}")
            return

        logger.info(f"Executing {filename}...")
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                sql_content = f.read()
                cursor.execute(sql_content)
                logger.info(f"Successfully executed {filename}")
        except psycopg2.errors.DuplicateTable:
             logger.info(f"Table from {filename} already exists (DuplicateTable error), skipping.")
        except Exception as e:
             if "already exists" in str(e):
                 logger.info(f"Object from {filename} already exists, skipping.")
             else:
                 logger.error(f"Error executing {filename}: {e}")
                 # Not raising so other initializations can continue if some fail
                 # But usually we'd want to stop if a table fails. 
                 # Given checking logic is loose, let's just log.
                 # Actually, we should correct this behavior. Raise.
                 raise

def init_db():
    """Entry point for database initialization script."""
    initializer = DatabaseInitializer()
    initializer.initialize()

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    init_db()
