#Requires -Version 5.1
<#
.SYNOPSIS
  First-time install for ebRouter client bundle (Docker Compose + PostgreSQL).
#>
param(
    [switch]$ForceEnv,
    [switch]$SkipPull
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "    $msg" -ForegroundColor Yellow }

function Test-Command($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function New-RandomHex([int]$Bytes = 32) {
    $buf = New-Object byte[] $Bytes
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buf)
    return -join ($buf | ForEach-Object { $_.ToString("x2") })
}

function New-RandomBase64([int]$Bytes = 32) {
    $buf = New-Object byte[] $Bytes
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buf)
    return [Convert]::ToBase64String($buf)
}

function New-RandomPassword([int]$Length = 16) {
    $chars = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    $bytes = New-Object byte[] $Length
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}

function Get-ComposeCmd {
    if (Test-Command "docker") {
        $null = docker compose version 2>$null
        if ($LASTEXITCODE -eq 0) { return @("docker", "compose") }
    }
    if (Test-Command "docker-compose") { return @("docker-compose") }
    throw "Docker Compose not found. Install Docker Desktop: https://docs.docker.com/desktop/"
}

function Read-EnvFile($path) {
    $map = @{}
    if (-not (Test-Path $path)) { return $map }
    Get-Content $path | ForEach-Object {
        $line = $_.Trim()
        if ($line -eq "" -or $line.StartsWith("#")) { return }
        $idx = $line.IndexOf("=")
        if ($idx -lt 1) { return }
        $key = $line.Substring(0, $idx).Trim()
        $val = $line.Substring($idx + 1).Trim()
        $map[$key] = $val
    }
    return $map
}

function Write-EnvFile($path, $map, $templatePath) {
    $lines = Get-Content $templatePath
    $out = foreach ($line in $lines) {
        if ($line -match '^\s*([A-Z0-9_]+)=(.*)$' -and $map.ContainsKey($Matches[1])) {
            "{0}={1}" -f $Matches[1], $map[$Matches[1]]
        } else {
            $line
        }
    }
    Set-Content -Path $path -Value $out -Encoding UTF8
}

Write-Step "Checking Docker"
if (-not (Test-Command "docker")) {
    throw "Docker is not installed. Install Docker Desktop for Windows first."
}
docker info *> $null
if ($LASTEXITCODE -ne 0) {
    throw "Docker is installed but not running. Start Docker Desktop and retry."
}
Write-Ok "Docker is running"

$compose = Get-ComposeCmd
Write-Ok ("Compose: " + ($compose -join " "))

Write-Step "Preparing environment file"
$envPath = Join-Path $PSScriptRoot ".env"
$examplePath = Join-Path $PSScriptRoot ".env.example"

if (-not (Test-Path $examplePath)) {
    throw ".env.example not found in $PSScriptRoot"
}

if ((Test-Path $envPath) -and -not $ForceEnv) {
    Write-Warn ".env already exists — keeping it (use -ForceEnv to regenerate secrets)"
    $envMap = Read-EnvFile $envPath
} else {
    if (Test-Path $envPath) { Write-Warn "Regenerating .env (-ForceEnv)" }
    $envMap = Read-EnvFile $examplePath

    if ([string]::IsNullOrWhiteSpace($envMap["POSTGRES_PASSWORD"])) {
        $envMap["POSTGRES_PASSWORD"] = New-RandomHex 16
    }
    if ([string]::IsNullOrWhiteSpace($envMap["JWT_SECRET"])) {
        $envMap["JWT_SECRET"] = New-RandomHex 32
    }
    if ([string]::IsNullOrWhiteSpace($envMap["INITIAL_PASSWORD"])) {
        $envMap["INITIAL_PASSWORD"] = New-RandomPassword 16
    }
    if ([string]::IsNullOrWhiteSpace($envMap["API_KEY_SECRET"])) {
        $envMap["API_KEY_SECRET"] = New-RandomHex 32
    }
    if ([string]::IsNullOrWhiteSpace($envMap["MACHINE_ID_SALT"])) {
        $envMap["MACHINE_ID_SALT"] = New-RandomHex 16
    }
    if ([string]::IsNullOrWhiteSpace($envMap["MASTER_KEY"])) {
        $envMap["MASTER_KEY"] = New-RandomBase64 32
    }

    Write-EnvFile $envPath $envMap $examplePath
    Write-Ok "Created .env with generated secrets"
}

$port = if ($envMap["PORT"]) { $envMap["PORT"] } else { "20128" }
$initialPassword = $envMap["INITIAL_PASSWORD"]
if (-not $initialPassword) {
    $initialPassword = (Read-EnvFile $envPath)["INITIAL_PASSWORD"]
}

Write-Step "Starting ebRouter stack"
if (-not $SkipPull) {
    & $compose[0] $compose[1..($compose.Length - 1)] pull
    if ($LASTEXITCODE -ne 0) { throw "docker compose pull failed" }
}

& $compose[0] $compose[1..($compose.Length - 1)] up -d
if ($LASTEXITCODE -ne 0) { throw "docker compose up failed" }

Write-Step "Waiting for health checks"
$deadline = (Get-Date).AddMinutes(3)
$healthy = $false
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 5
    $psOut = & $compose[0] $compose[1..($compose.Length - 1)] ps --format json 2>$null
    if ($psOut -match '"Health":"healthy"' -and $psOut -match 'ebrouter') {
        $healthy = $true
        break
    }
    # Fallback: HTTP probe once port is up
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:${port}/api/health" -UseBasicParsing -TimeoutSec 5
        if ($r.StatusCode -eq 200) { $healthy = $true; break }
    } catch { }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host " ebRouter is installed" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Dashboard : http://localhost:${port}/dashboard"
Write-Host "  API       : http://localhost:${port}/v1"
Write-Host "  Password  : $initialPassword"
Write-Host ""
Write-Host "  Change the password after first login (Settings)."
Write-Host "  Back up .env and run backup.ps1 regularly."
Write-Host ""
if (-not $healthy) {
    Write-Warn "Health check still pending — run: docker compose ps"
    Write-Warn "Logs: docker compose logs -f ebrouter"
}
