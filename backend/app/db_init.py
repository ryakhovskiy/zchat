"""Database initialization using raw SQL queries."""
import sqlite3
import os
import re
from pathlib import Path
from typing import Dict, List, Tuple, Optional
from app.config import get_settings

settings = get_settings()


class DatabaseInitializer:
    """Initialize database using SQL files from app/sql directory."""
    
    def __init__(self):
        self.db_path = self._get_db_path()
        self.sql_dir = Path(__file__).parent / "sql"
        # Order matters: create tables with no foreign keys first
        self.table_files = [
            "users.sql",
            "conversations.sql",
            "conversation_participants.sql",
            "messages.sql"
        ]
        self.index_file = "indexes.sql"
    
    def _get_db_path(self) -> str:
        """Extract database file path from DATABASE_URL."""
        db_url = settings.DATABASE_URL
        
        # Handle sqlite:///./zchat.db format
        if db_url.startswith("sqlite:///"):
            db_path = db_url.replace("sqlite:///", "")
            # Handle absolute vs relative paths
            if db_path.startswith("./"):
                # Relative path: place in backend directory
                base_dir = Path(__file__).parent.parent
                db_path = base_dir / db_path[2:]
            else:
                db_path = Path(db_path)
            return str(db_path)
        else:
            raise ValueError(f"Unsupported DATABASE_URL format: {db_url}")
    
    def _table_exists(self, cursor: sqlite3.Cursor, table_name: str) -> bool:
        """Check if a table exists in the database."""
        cursor.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            (table_name,)
        )
        return cursor.fetchone() is not None
    
    def _get_existing_columns(self, cursor: sqlite3.Cursor, table_name: str) -> Dict[str, str]:
        """Get existing columns and their types for a table."""
        cursor.execute(f"PRAGMA table_info({table_name})")
        columns = {}
        for row in cursor.fetchall():
            # row: (cid, name, type, notnull, dflt_value, pk)
            col_name = row[1].lower()
            col_type = row[2].upper() if row[2] else ""
            columns[col_name] = col_type
        return columns
    
    def _parse_columns_from_sql(self, sql_content: str) -> List[Tuple[str, str, str]]:
        """
        Parse column definitions from CREATE TABLE SQL.
        Returns list of (column_name, column_type, full_definition).
        """
        columns = []
        
        # Find the content between parentheses
        match = re.search(r'CREATE\s+TABLE\s+\w+\s*\((.*)\)', sql_content, re.IGNORECASE | re.DOTALL)
        if not match:
            return columns
        
        content = match.group(1)
        
        # Split by comma, but be careful with nested parentheses
        parts = []
        current = ""
        paren_depth = 0
        
        for char in content:
            if char == '(':
                paren_depth += 1
                current += char
            elif char == ')':
                paren_depth -= 1
                current += char
            elif char == ',' and paren_depth == 0:
                parts.append(current.strip())
                current = ""
            else:
                current += char
        
        if current.strip():
            parts.append(current.strip())
        
        for part in parts:
            part = part.strip()
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
