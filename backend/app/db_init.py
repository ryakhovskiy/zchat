"""Database initialization using raw SQL queries with PostgreSQL."""
import logging
import os
import time
from pathlib import Path
from typing import List
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
            # Skip constraints (PRIMARY KEY, FOREIGN KEY, UNIQUE, CHECK, etc.)
            upper_part = part.upper()
            if any(upper_part.startswith(kw) for kw in ['PRIMARY KEY', 'FOREIGN KEY', 'UNIQUE', 'CHECK', 'CONSTRAINT']):
                continue
            
            # Parse column definition: name type [constraints...]
            tokens = part.split()
            if len(tokens) >= 2:
                col_name = tokens[0].lower()
                col_type = tokens[1].upper()
                # Get the full definition after the column name (type + constraints)
                full_def = ' '.join(tokens[1:])
                columns.append((col_name, col_type, full_def))
        
        return columns
    
    def _add_missing_columns(
        self, 
        cursor: sqlite3.Cursor, 
        conn: sqlite3.Connection,
        table_name: str, 
        sql_content: str
    ) -> bool:
        """
        Check for missing columns and add them to the table.
        Returns True if any columns were added.
        """
        existing_columns = self._get_existing_columns(cursor, table_name)
        expected_columns = self._parse_columns_from_sql(sql_content)
        
        columns_added = False
        
        for col_name, col_type, full_def in expected_columns:
            if col_name not in existing_columns:
                # Column is missing, add it
                # For SQLite, we need to handle DEFAULT values carefully
                alter_sql = f"ALTER TABLE {table_name} ADD COLUMN {col_name} {full_def}"
                print(f"  → Adding column '{col_name}' to table '{table_name}'")
                try:
                    cursor.execute(alter_sql)
                    conn.commit()
                    print(f"  ✓ Column '{col_name}' added successfully")
                    columns_added = True
                except sqlite3.Error as e:
                    print(f"  ⚠ Warning: Could not add column '{col_name}': {e}")
        
        return columns_added
    
    def _get_table_name_from_sql(self, sql_content: str) -> str:
        """Extract table name from CREATE TABLE statement."""
        # Simple parser: look for "CREATE TABLE table_name"
        for line in sql_content.split('\n'):
            line = line.strip().upper()
            if line.startswith('CREATE TABLE'):
                # Extract table name
                parts = line.split()
                if len(parts) >= 3:
                    table_name = parts[2].lower().rstrip('(')
                    return table_name
        return ""
    
    def _create_indexes(self, cursor: sqlite3.Cursor, conn: sqlite3.Connection) -> None:
        """Create database indexes if they don't exist."""
        index_path = self.sql_dir / self.index_file
        
        if not index_path.exists():
            print(f"⚠ Warning: Index file not found: {index_path}")
            return
        
        try:
            with open(index_path, 'r', encoding='utf-8') as f:
                index_sql = f.read()
            
            # Split by semicolon and execute each statement
            statements = [s.strip() for s in index_sql.split(';') if s.strip()]
            
            print(f"→ Creating indexes...")
            for statement in statements:
                if statement.strip():
                    cursor.execute(statement)
            
            conn.commit()
            print(f"✓ Indexes created successfully")
            
        except sqlite3.Error as e:
            print(f"⚠ Warning: Could not create indexes: {e}")
            # Don't fail initialization if indexes fail
    
    def initialize(self) -> None:
        """Initialize the database: create if not exists, create tables if not exist."""
        # Check if database file exists
        db_exists = os.path.exists(self.db_path)
        
        if not db_exists:
            print(f"→ Creating database file: {self.db_path}")
            # Ensure parent directory exists
            os.makedirs(os.path.dirname(self.db_path) or ".", exist_ok=True)
        else:
            print(f"✓ Database file exists: {self.db_path}")
        
        # Connect to database (creates file if not exists)
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        try:
            # Enable foreign keys
            cursor.execute("PRAGMA foreign_keys = ON")
            
            # Process each SQL file
            for sql_file in self.table_files:
                sql_path = self.sql_dir / sql_file
                
                if not sql_path.exists():
                    print(f"⚠ Warning: SQL file not found: {sql_path}")
                    continue
                
                # Read SQL content
                with open(sql_path, 'r', encoding='utf-8') as f:
                    sql_content = f.read()
                
                # Extract table name
                table_name = self._get_table_name_from_sql(sql_content)
                
                if not table_name:
                    print(f"⚠ Warning: Could not extract table name from {sql_file}")
                    continue
                
                # Check if table exists
                if self._table_exists(cursor, table_name):
                    print(f"✓ Table '{table_name}' already exists")
                    # Check for missing columns and add them
                    self._add_missing_columns(cursor, conn, table_name, sql_content)
                else:
                    print(f"→ Creating table '{table_name}'")
                    cursor.execute(sql_content)
                    conn.commit()
                    print(f"✓ Table '{table_name}' created successfully")
            
            # Create indexes
            self._create_indexes(cursor, conn)
            
            print("✓ Database initialization complete")
            
        except sqlite3.Error as e:
            print(f"✗ Database initialization error: {e}")
            conn.rollback()
            raise
        finally:
            conn.close()
    
    def reset_database(self) -> None:
        """Drop all tables and recreate them. Use with caution!"""
        if not os.path.exists(self.db_path):
            print(f"Database does not exist: {self.db_path}")
            return
        
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        try:
            # Get all tables
            cursor.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            )
            tables = cursor.fetchall()
            
            # Drop each table
            for (table_name,) in tables:
                print(f"→ Dropping table '{table_name}'")
                cursor.execute(f"DROP TABLE IF EXISTS {table_name}")
            
            conn.commit()
            print("✓ All tables dropped")
            
            # Recreate tables
            self.initialize()
            
        except sqlite3.Error as e:
            print(f"✗ Database reset error: {e}")
            conn.rollback()
            raise
        finally:
            conn.close()


def init_database() -> None:
    """Initialize the database - convenience function for app startup."""
    initializer = DatabaseInitializer()
    initializer.initialize()
