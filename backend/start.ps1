# Check if Python is installed
try {
    $pythonVersion = python --version 2>&1
    Write-Host "Found Python: $pythonVersion"
} catch {
    Write-Error "Python is not installed or not in PATH. Please install Python 3.11 or later."
    exit 1
}

# Check if uv is installed
if (Get-Command uv -ErrorAction SilentlyContinue) {
    Write-Host "Found uv: $(uv --version)"
} else {
    Write-Host "uv not found. Installing uv..."
    pip install uv
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to install uv via pip. Please install uv manually."
        exit 1
    }
}

# Ensure we are in the backend directory
$scriptPath = $PSScriptRoot
Set-Location $scriptPath

# Install/Sync dependencies
Write-Host "Syncing dependencies with uv..."
uv sync
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to sync dependencies."
    exit 1
}

# Start the application
Write-Host "Starting backend server..."
uv run uvicorn app.main:app --reload
