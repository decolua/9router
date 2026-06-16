@echo off
setlocal enabledelayedexpansion

:: Check for Administrator privileges
net session >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo Requesting administrative privileges...
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

:: Set working directory to the directory of this batch file
cd /d "%~dp0"

title 9Router - Production Server
color 0B

echo ===================================================
echo              9Router Production Server             
echo ===================================================
echo.

:: Check for production build (.next folder)
if not exist ".next" (
    color 0C
    echo [ERROR] Production build not found.
    echo Please run build.bat first to build the application.
    echo.
    pause
    exit /b 1
)

:: Release port 20128 if it is in use
echo Checking if port 20128 is already in use...
powershell -Command "try { Get-NetTCPConnection -LocalPort 20128 -ErrorAction Stop | ForEach-Object { Write-Host 'Port 20128 is currently in use by process ID' $_.OwningProcess '. Releasing port...'; Stop-Process -Id $_.OwningProcess -Force; Write-Host '[✓] Successfully stopped process' $_.OwningProcess 'to release port.' } } catch {}; exit 0"
echo.

echo Starting 9Router on port 20128...
set PORT=20128
set HOSTNAME=0.0.0.0
set NEXT_PUBLIC_BASE_URL=http://localhost:20128

call npm run start
if %ERRORLEVEL% neq 0 (
    color 0C
    echo.
    echo [ERROR] Failed to start 9Router.
    pause
    exit /b %ERRORLEVEL%
)
