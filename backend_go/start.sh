#!/usr/bin/env bash
set -euo pipefail

# Simple helper to check if a command exists
command_exists() {
	command -v "$1" >/dev/null 2>&1
}

# Ensure Go is installed
if ! command_exists go; then
	echo "Error: Go is not installed or not in PATH. Please install Go 1.21+."
	exit 1
fi

echo "Found Go: $(go version)"

# Ensure we are in the script's directory (backend_go root)
cd "$(dirname "$0")"

# Ensure Go dependencies are installed (modules downloaded)
echo "Syncing Go modules..."
go mod download

# Provide sensible dev defaults for required secrets if not set
if [[ -z "${JWT_SECRET:-}" ]]; then
	export JWT_SECRET="dev-jwt-secret-change-me"
	echo "JWT_SECRET not set, using development default."
fi

if [[ -z "${ENCRYPTION_KEY:-}" ]]; then
	export ENCRYPTION_KEY="dev-encryption-key-change-me"
	echo "ENCRYPTION_KEY not set, using development default."
fi

if [[ -z "${HTTP_PORT:-}" ]]; then
	export HTTP_PORT=8000
fi

echo "Starting Go backend on ${HTTP_HOST:-0.0.0.0}:$HTTP_PORT ..."
go run ./cmd/server

