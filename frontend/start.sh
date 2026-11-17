#!/bin/bash
set -e

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# 1. Check Node.js
if command_exists node; then
    echo "Found Node.js: $(node --version)"
else
    echo "Error: Node.js is not installed. Please install Node.js."
    exit 1
fi

# 2. Check npm
if command_exists npm; then
    echo "Found npm: $(npm --version)"
else
    echo "Error: npm is not installed. Please install Node.js which includes npm."
    exit 1
fi

# Ensure we are in the script's directory (assuming script is in frontend root)
cd "$(dirname "$0")"

# 3. Install dependencies
echo "Installing dependencies..."
npm install

# 4. Start the application
echo "Starting frontend server..."
npm run dev
