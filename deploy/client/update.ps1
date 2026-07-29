#Requires -Version 5.1
<#
.SYNOPSIS
  Pull a newer ebRouter image and restart (PostgreSQL data is preserved).
#>
param(
    [string]$Image = ""
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

function Set-EnvVal($key, $val) {
    $path = Join-Path $PSScriptRoot ".env"
    $lines = Get-Content $path
    $found = $false
    $out = foreach ($line in $lines) {
        if ($line -match "^\s*$key=") {
            $found = $true
            "$key=$val"
        } else { $line }
    }
    if (-not $found) { $out += "$key=$val" }
    Set-Content -Path $path -Value $out -Encoding UTF8
}

$compose = Get-ComposeCmd

if ($Image) {
    Write-Host "Setting EBROUTER_IMAGE=$Image in .env"
    Set-EnvVal "EBROUTER_IMAGE" $Image
}

Write-Host "Pulling images..."
& $compose[0] $compose[1..($compose.Length - 1)] pull
if ($LASTEXITCODE -ne 0) { throw "pull failed" }

Write-Host "Recreating containers (volumes unchanged)..."
& $compose[0] $compose[1..($compose.Length - 1)] up -d
if ($LASTEXITCODE -ne 0) { throw "up failed" }

$port = "20128"
$envPath = Join-Path $PSScriptRoot ".env"
if (Test-Path $envPath) {
    foreach ($line in Get-Content $envPath) {
        if ($line -match '^\s*PORT=(.*)$') { $port = $Matches[1].Trim(); break }
    }
}

Write-Host ""
Write-Host "Update complete. Dashboard: http://localhost:${port}/dashboard"
Write-Host "Check version in dashboard or: curl http://localhost:${port}/api/version"
