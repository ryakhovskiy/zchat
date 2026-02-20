#requires -version 5.0

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Test-Command {
    param(
        [Parameter(Mandatory = $true)][string]$Name
    )
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

# Ensure Go is installed
if (-not (Test-Command -Name "go")) {
    Write-Error "Go is not installed or not in PATH. Please install Go 1.21+."
    exit 1
}

Write-Host "Found Go: $(go version)"

# Switch to backend_go directory (script location)
$scriptPath = $PSScriptRoot
Set-Location $scriptPath

# Ensure Go dependencies are installed (modules downloaded)
Write-Host "Syncing Go modules..."
go mod download
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to download Go modules (go mod download)."
    exit 1
}

# Provide sensible dev defaults for required secrets if not set
if (-not $Env:JWT_SECRET) {
    $Env:JWT_SECRET = "dev-jwt-secret-change-me"
    Write-Warning "JWT_SECRET not set, using development default."
}

if (-not $Env:ENCRYPTION_KEY) {
    $Env:ENCRYPTION_KEY = "dev-encryption-key-change-me"
    Write-Warning "ENCRYPTION_KEY not set, using development default."
}

if (-not $Env:HTTP_PORT) {
    $Env:HTTP_PORT = "8000"
}

Write-Host "Starting Go backend on $($Env:HTTP_HOST -or '0.0.0.0'):$($Env:HTTP_PORT -or '8000') ..."
go run ./cmd/server

