#!/bin/bash
set -e

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# 1. Check Python
if command_exists python3; then
    PYTHON_CMD=python3
elif command_exists python; then
    PYTHON_CMD=python
else
    echo "Error: Python is not installed. Please install Python 3.11 or later."
    exit 1
fi

echo "Found Python: $($PYTHON_CMD --version)"

# 2. Check uv
if command_exists uv; then
    echo "Found uv: $(uv --version)"
else
    echo "uv not found. Installing uv..."
    $PYTHON_CMD -m pip install uv
    
    # Check if installation was successful
    if ! command_exists uv; then
        echo "Warning: uv installed but not found in PATH. Trying to run via module..."
        if ! $PYTHON_CMD -m uv --version >/dev/null 2>&1; then
             echo "Error: Failed to install uv."
             exit 1
        fi
    fi
fi

# Ensure we are in the script's directory (assuming script is in backend root)
cd "$(dirname "$0")"

# 3. Sync dependencies
echo "Syncing dependencies with uv..."
# If uv is in path
if command_exists uv; then
    uv sync
else
    # Fallback if uv is installed but not in path (e.g. ~/.local/bin not in PATH)
    $PYTHON_CMD -m uv sync
fi

# 4. Start the application
echo "Starting backend server..."
if command_exists uv; then
    uv run uvicorn app.main:app --reload
else
    $PYTHON_CMD -m uv run uvicorn app.main:app --reload
fi
