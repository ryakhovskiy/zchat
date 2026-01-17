# Development Scripts

This directory contains utility scripts for development and database management.

## db_manager.py

A unified database management tool for initializing, inspecting, and resetting the database.

### Usage

**Initialize the database:**
```bash
python scripts/db_manager.py init
```

**Inspect database schema:**
```bash
python scripts/db_manager.py inspect
```

**Reset database (drops all tables and recreates):**
```bash
python scripts/db_manager.py reset
```

### Features

- **init** - Creates database file if needed, creates tables and indexes
- **inspect** - Shows detailed schema information including:
  - All tables with columns and types
  - Row counts
  - Foreign key relationships
  - Indexes
- **reset** - Drops all tables and recreates them (with confirmation prompt)

### Examples

```bash
# Set up a fresh database
python scripts/db_manager.py init

# Check what was created
python scripts/db_manager.py inspect

# Start over (will ask for confirmation)
python scripts/db_manager.py reset
```
