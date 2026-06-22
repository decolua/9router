#Requires -Version 5.1
<#
.SYNOPSIS
  Backup PostgreSQL database for ebRouter client deployment.
#>
param(
    [string]$OutDir = ""
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Get-ComposeCmd {
    if (Get-Command docker -ErrorAction SilentlyContinue) {
        $null = docker compose version 2>$null
        if ($LASTEXITCODE -eq 0) { return @("docker", "compose") }
    }
    if (Get-Command docker-compose -ErrorAction SilentlyContinue) { return @("docker-compose") }
    throw "Docker Compose not found"
}

function Read-EnvVal($key) {
    $path = Join-Path $PSScriptRoot ".env"
    if (-not (Test-Path $path)) { return $null }
    foreach ($line in Get-Content $path) {
        if ($line -match "^\s*$key=(.*)$") { return $Matches[1].Trim() }
    }
    return $null
}

$compose = Get-ComposeCmd
$backupRoot = if ($OutDir) { $OutDir } else { Join-Path $PSScriptRoot "backups" }
New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$dbUser = Read-EnvVal "POSTGRES_USER"
$dbName = Read-EnvVal "POSTGRES_DB"
if (-not $dbUser) { $dbUser = "ebrouter" }
if (-not $dbName) { $dbName = "ebrouter" }

$sqlFile = Join-Path $backupRoot "ebrouter-${stamp}.sql"
$envFile = Join-Path $backupRoot "env-reference-${stamp}.txt"

Write-Host "Backing up PostgreSQL to $sqlFile ..."

& $compose[0] $compose[1..($compose.Length - 1)] exec -T postgres `
    pg_dump -U $dbUser -d $dbName --clean --if-exists --no-owner --no-acl `
    | Set-Content -Path $sqlFile -Encoding UTF8

if ($LASTEXITCODE -ne 0) { throw "pg_dump failed" }

@"
ebRouter backup $stamp
Database: $dbName
User: $dbUser

IMPORTANT: Store .env separately in a secure location (contains secrets).
To restore: ./restore.ps1 -SqlFile "$sqlFile"
"@ | Set-Content -Path $envFile -Encoding UTF8

Write-Host "Done."
Write-Host "  SQL backup : $sqlFile"
Write-Host "  Also secure: $(Join-Path $PSScriptRoot '.env')"

$cutoff = (Get-Date).AddDays(-30)
Get-ChildItem -Path $backupRoot -File | Where-Object {
  $_.Name -match '^(ebrouter-|env-reference-)' -and $_.LastWriteTime -lt $cutoff
} | Remove-Item -Force
Write-Host "Pruned backups older than 30 days in $backupRoot"
