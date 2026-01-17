"""Utility script to inspect the database schema."""
import sqlite3
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.db_init import DatabaseInitializer


def inspect_database():
    """Inspect and display database schema information."""
    initializer = DatabaseInitializer()
    db_path = initializer.db_path
    
    if not Path(db_path).exists():
        print(f"✗ Database does not exist: {db_path}")
        print("Run the application or test_db_init.py to create it.")
        return
    
    print(f"Database: {db_path}")
    print("=" * 80)
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    try:
        # Get all tables
        cursor.execute("""
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name NOT LIKE 'sqlite_%'
            ORDER BY name
        """)
        tables = cursor.fetchall()
        
        if not tables:
            print("No tables found in database.")
            return
        
        print(f"\nTables found: {len(tables)}")
        print("-" * 80)
        
        for (table_name,) in tables:
            print(f"\n📊 Table: {table_name}")
            print("-" * 80)
            
            # Get table schema
            cursor.execute(f"PRAGMA table_info({table_name})")
            columns = cursor.fetchall()
            
            print(f"{'Column':<25} {'Type':<15} {'Not Null':<10} {'Default':<15} {'PK'}")
            print("-" * 80)
            for col in columns:
                cid, name, dtype, notnull, dflt_value, pk = col
                print(f"{name:<25} {dtype:<15} {str(bool(notnull)):<10} {str(dflt_value):<15} {str(bool(pk))}")
            
            # Get row count
            cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
            count = cursor.fetchone()[0]
            print(f"\nRows: {count}")
            
            # Get foreign keys
            cursor.execute(f"PRAGMA foreign_key_list({table_name})")
            fks = cursor.fetchall()
            if fks:
                print("\nForeign Keys:")
                for fk in fks:
                    print(f"  → {fk[2]}.{fk[4]} (on {fk[3]})")
        
        # Get indexes
        print("\n" + "=" * 80)
        print("📑 Indexes")
        print("-" * 80)
        cursor.execute("""
            SELECT name, tbl_name FROM sqlite_master 
            WHERE type='index' AND name NOT LIKE 'sqlite_%'
            ORDER BY tbl_name, name
        """)
        indexes = cursor.fetchall()
        
        current_table = None
        for idx_name, tbl_name in indexes:
            if current_table != tbl_name:
                current_table = tbl_name
                print(f"\n{tbl_name}:")
            print(f"  • {idx_name}")
        
        print("\n" + "=" * 80)
        print("✓ Inspection complete")
        
    except sqlite3.Error as e:
        print(f"✗ Error inspecting database: {e}")
    finally:
        conn.close()


if __name__ == "__main__":
    inspect_database()
