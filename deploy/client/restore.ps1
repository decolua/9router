#Requires -Version 5.1
<#
.SYNOPSIS
  Restore PostgreSQL from a backup .sql file created by backup.ps1.
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$SqlFile
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path $SqlFile)) {
    throw "Backup file not found: $SqlFile"
}

function Get-ComposeCmd {
    if (Get-Command docker -ErrorAction SilentlyContinue) {
        $null = docker compose version 2>$null
        if ($LASTEXITCODE -eq 0) { return @("docker", "compose") }
    }
    if (Get-Command docker-compose -ErrorAction SilentlyContinue) { return @("docker-compose") }
    throw "Docker Compose not found"
}

function Read-EnvVal($key) {
    foreach ($line in Get-Content (Join-Path $PSScriptRoot ".env")) {
        if ($line -match "^\s*$key=(.*)$") { return $Matches[1].Trim() }
    }
    return $null
}

$compose = Get-ComposeCmd
$dbUser = Read-EnvVal "POSTGRES_USER"
$dbName = Read-EnvVal "POSTGRES_DB"
if (-not $dbUser) { $dbUser = "ebrouter" }
if (-not $dbName) { $dbName = "ebrouter" }

Write-Host "WARNING: This replaces all data in database '$dbName'." -ForegroundColor Yellow
$confirm = Read-Host "Type RESTORE to continue"
if ($confirm -ne "RESTORE") { throw "Aborted" }

Write-Host "Stopping ebRouter app..."
& $compose[0] $compose[1..($compose.Length - 1)] stop ebrouter

Write-Host "Restoring from $SqlFile ..."
Get-Content $SqlFile -Raw | & $compose[0] $compose[1..($compose.Length - 1)] exec -T postgres `
    psql -U $dbUser -d $dbName -v ON_ERROR_STOP=1

if ($LASTEXITCODE -ne 0) { throw "restore failed" }

Write-Host "Starting ebRouter..."
& $compose[0] $compose[1..($compose.Length - 1)] start ebrouter

Write-Host "Restore complete."
