@echo off
chcp 65001 >nul
title 9Router PM2 Launcher

:: =============================================================
::  start-with-recovery.bat — 9Router via PM2
:: =============================================================

set NODE_ENV=production
set PORT=20128
set HOSTNAME=0.0.0.0
cd /d "%~dp0"

echo.
echo ============================================
echo    9Router - PM2 Launcher
echo ============================================
echo.

:: Check if PM2 is installed globally
where pm2 >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [WARN] PM2 not found. Installing globally...
    call npm install -g pm2
    if %ERRORLEVEL% NEQ 0 (
        echo [ERROR] Failed to install PM2.
        pause
        exit /b 1
    )
    echo [OK] PM2 installed.
) else (
    echo [OK] PM2 found.
)

:: Check if 9router already running
pm2 show 9router >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [OK] 9router already running under PM2.
    echo [INFO] Status:
    pm2 status 9router
    echo.
    echo Commands:
    echo   pm2 logs 9router    - view logs
    echo   pm2 restart 9router - restart
) else (
    echo [INFO] Starting 9router via PM2...
    pm2 start ecosystem.config.js --env production
    if %ERRORLEVEL% NEQ 0 (
        echo [ERROR] Failed to start 9router.
        echo [INFO] Make sure build exists: npm run build
        pause
        exit /b 1
    )
    echo [OK] 9router started.
)

echo.
echo ============================================
echo   Server: http://localhost:20128
echo ============================================
echo.

:: Save PM2 process list for auto-start on OS boot
call pm2 save

echo.
echo Press any key to view logs in real time...
echo (close log window to keep server running)
pause >nul

:: Open log window
start "9Router Logs" cmd /k "pm2 logs 9router"