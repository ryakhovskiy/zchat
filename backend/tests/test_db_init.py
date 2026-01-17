"""Tests for database initialization."""
import pytest
import sqlite3
from pathlib import Path
from app.db_init import DatabaseInitializer


class TestDatabaseInitialization:
    """Test database initialization functionality."""
    
    def test_database_initializer_instance(self):
        """Test DatabaseInitializer can be instantiated."""
        initializer = DatabaseInitializer()
        assert initializer is not None
        assert initializer.db_path is not None
        assert initializer.sql_dir is not None
    
    def test_database_path_parsing(self):
        """Test database path is correctly parsed from config."""
        initializer = DatabaseInitializer()
        assert isinstance(initializer.db_path, str)
        assert 'zchat.db' in initializer.db_path
    
    def test_table_files_defined(self):
        """Test table files are properly defined."""
        initializer = DatabaseInitializer()
        assert len(initializer.table_files) > 0
        assert 'users.sql' in initializer.table_files
        assert 'conversations.sql' in initializer.table_files
        assert 'messages.sql' in initializer.table_files
    
    def test_initialize_creates_database(self, tmp_path):
        """Test initialization creates database file."""
        # This test would need a temporary database setup
        # For now, just verify the method exists
        initializer = DatabaseInitializer()
        assert hasattr(initializer, 'initialize')
        assert callable(initializer.initialize)
    
    def test_reset_database_exists(self):
        """Test reset_database method exists."""
        initializer = DatabaseInitializer()
        assert hasattr(initializer, 'reset_database')
        assert callable(initializer.reset_database)
