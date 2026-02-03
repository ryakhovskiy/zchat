# Check if Node.js is installed
try {
    $nodeVersion = node --version 2>&1
    Write-Host "Found Node.js: $nodeVersion"
} catch {
    Write-Error "Node.js is not installed or not in PATH. Please install Node.js."
    exit 1
}

# Check if npm is installed
try {
    $npmVersion = npm --version 2>&1
    Write-Host "Found npm: $npmVersion"
} catch {
    Write-Error "npm is not installed or not in PATH. Please install Node.js which includes npm."
    exit 1
}

# Ensure we are in the frontend directory
$scriptPath = $PSScriptRoot
Set-Location $scriptPath

# Install dependencies
Write-Host "Installing dependencies..."
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to install dependencies."
    exit 1
}

# Start the application
Write-Host "Starting frontend server..."
npm run dev
