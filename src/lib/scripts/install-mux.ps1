param (
    [string]$TargetDir,
    [string]$Update = "true"
)

$ErrorActionPreference = "Stop"

Write-Host "Starting Mux Installer Script..."
Write-Host "Target Directory: $TargetDir"
Write-Host "Update: $Update"

# 1. Clone or Pull
if (-not (Test-Path $TargetDir)) {
    Write-Host "Cloning Mux repository..."
    git clone https://github.com/coder/mux.git $TargetDir
} else {
    if (Test-Path "$TargetDir\.git") {
        if ($Update -eq "true") {
            Write-Host "Pulling latest changes from GitHub..."
            cd $TargetDir
            git pull
        } else {
            Write-Host "Using existing local codebase (skipping git pull)..."
        }
    } else {
        Write-Host "Detecting corrupt target directory. Re-creating..."
        Remove-Item -Path $TargetDir -Recurse -Force -ErrorAction SilentlyContinue
        git clone https://github.com/coder/mux.git $TargetDir
    }
}

# 2. Install dependencies
Write-Host "Installing dependencies..."
cd $TargetDir

# Clean node_modules if exists to prevent locks
if (Test-Path "node_modules") {
    Write-Host "Cleaning up previous node_modules..."
    Remove-Item -Path "node_modules" -Recurse -Force -ErrorAction SilentlyContinue
}

# Clear any zombie bun/node processes holding locks
Write-Host "Checking for locked files..."
try {
    Get-Process -Name "bun" -ErrorAction SilentlyContinue | Stop-Process -Force
    Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like "npm*" } | Stop-Process -Force
} catch {
    # Ignore process termination errors
}

try {
    Write-Host "Running npm install (highly stable)..."
    npm install --legacy-peer-deps --no-audit --no-fund
} catch {
    Write-Host "npm install failed. Falling back to Bun..."
    bun install --backend=copy
}

# 3. Build Mux
Write-Host "Compiling Mux CLI & Web UI..."
$VersionFile = "src/version.ts"
Set-Content -Path $VersionFile -Value 'export const VERSION = { git_describe: "0.26.1" };'

Write-Host "Building API..."
bun x esbuild src/cli/api.ts --bundle --format=esm --platform=node --outfile=dist/cli/api.mjs

Write-Host "Building TypeScript..."
bun x tsc -p tsconfig.main.json

Write-Host "Rewriting aliases..."
bun x tsc-alias -p tsconfig.main.json

Write-Host "Building Web UI..."
bun x vite build

# Copy static assets
New-Item -ItemType Directory -Force -Path "dist" | Out-Null
if (Test-Path "static/splash.html") {
    Copy-Item -Path "static/splash.html" -Destination "dist/splash.html" -Force
}
if (Test-Path "public") {
    Copy-Item -Path "public" -Destination "dist" -Recurse -Force
}

Write-Host "Mux Build Completed successfully!"
