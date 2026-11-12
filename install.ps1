# 9router (fahmi0812 fork, Kiro fix) installer for Windows
# Usage: irm https://raw.githubusercontent.com/fahmi0812/9router/kiro-fix/install.ps1 | iex
$ErrorActionPreference = "Stop"
$pkg = "https://github.com/fahmi0812/9router/releases/latest/download/9router-kiro.tgz"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Node.js not found. Installing Node.js LTS via winget..."
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}

Get-Process -Name node -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*9router*" } |
    Stop-Process -Force -ErrorAction SilentlyContinue

npm install -g $pkg
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

Write-Host ""
Write-Host "Done. Start with: 9router --skip-update"
