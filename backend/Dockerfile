# Use the official uv image which includes Python and uv
# We use python3.11-bookworm-slim to match the requires-python >=3.11 in pyproject.toml
FROM ghcr.io/astral-sh/uv:python3.11-bookworm-slim

# Set working directory
WORKDIR /app

# Set environment variables
# UV_COMPILE_BYTECODE=1: Compile bytes to improve startup time
# UV_LINK_MODE=copy: Copy files instead of hardlinking (safer for Docker)
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1

# Copy dependency files
COPY pyproject.toml uv.lock ./

# Install dependencies
# --frozen: Sync with exact versions from uv.lock
# --no-install-project: Don't install the project itself (zchat-backend), just dependencies
# --no-dev: Don't install dev dependencies
RUN uv sync --no-install-project --no-dev

# Add Virtual Environment to PATH
ENV PATH="/app/.venv/bin:$PATH"

# Copy the rest of the application
COPY . .

# Create uploads directory
RUN mkdir -p uploads

# Expose port
EXPOSE 8000

# Command to run the application
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
