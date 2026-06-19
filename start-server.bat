@echo off
cd /d "%~dp0"
echo Stopping any old 9Router processes...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :20128') do taskkill /PID %%a /F 2>nul
timeout /t 1 /nobreak >nul
echo Starting 9Router v0.5.4 (production mode)...
echo Dashboard: http://localhost:20128
echo.
set PORT=20128
set NODE_ENV=production
set HOSTNAME=0.0.0.0
set NEXT_PUBLIC_BASE_URL=http://localhost:20128
npm run start
pause
