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

:: Set window title and colors
title 9Router - Production Build
color 0B

echo ===================================================
echo             9Router Production Builder            
echo ===================================================
echo.

:: Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    color 0C
    echo [ERROR] Node.js is not installed or not in the PATH.
    echo Please install Node.js (v18+) and try again.
    pause
    exit /b 1
)

:: Check if npm is installed
where npm >nul 2>nul
if %ERRORLEVEL% neq 0 (
    color 0C
    echo [ERROR] npm is not installed or not in the PATH.
    echo Please install npm and try again.
    pause
    exit /b 1
)

:: Release port 20128 if it is in use to avoid locked files during build
echo Checking if port 20128 is already in use...
powershell -Command "try { Get-NetTCPConnection -LocalPort 20128 -ErrorAction Stop | ForEach-Object { Write-Host 'Port 20128 is currently in use by process ID' $_.OwningProcess '. Releasing port...'; Stop-Process -Id $_.OwningProcess -Force; Write-Host '[✓] Successfully stopped process' $_.OwningProcess 'to release port.' } } catch {}; exit 0"
echo.
echo [1/3] Node.js and npm verified:
for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
for /f "tokens=*" %%i in ('npm -v') do set NPM_VER=%%i
echo   - Node.js: %NODE_VER%
echo   - npm: %NPM_VER%
echo.

echo [2/3] Installing dependencies...
call npm install
if %ERRORLEVEL% neq 0 (
    color 0C
    echo.
    echo [ERROR] npm install failed.
    pause
    exit /b %ERRORLEVEL%
)
echo.
echo [✓] Dependencies installed successfully.
echo.

echo [3/3] Creating production build...
call npm run build
if %ERRORLEVEL% neq 0 (
    color 0C
    echo.
    echo [ERROR] Production build failed.
    pause
    exit /b %ERRORLEVEL%
)

color 0A
echo.
echo ===================================================
echo   [✓] 9Router Production Build Created Successfully
echo ===================================================
echo.
echo To run the application in production mode, run: start.bat
echo.
pause
