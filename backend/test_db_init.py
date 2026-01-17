"""Test script to initialize the database."""
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.db_init import DatabaseInitializer

if __name__ == "__main__":
    print("Testing database initialization...")
    initializer = DatabaseInitializer()
    
    print(f"\nDatabase path: {initializer.db_path}")
    print(f"SQL directory: {initializer.sql_dir}")
    print(f"\nTable files to process:")
    for i, file in enumerate(initializer.table_files, 1):
        print(f"  {i}. {file}")
    
    print("\n" + "=" * 60)
    initializer.initialize()
    print("=" * 60)
    print("\n✓ Test completed successfully!")
