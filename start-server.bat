@echo off
cd /d "%~dp0"
echo Stopping any old 9Router processes...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :20128') do taskkill /PID %%a /F 2>nul
timeout /t 1 /nobreak >nul

:: Backup DB to AppData (страховка)
set YD_DATA=C:\Users\Dmitry\Yandex.Disk\САЙТЫ\9router-data
set APPDATA_9ROUTER=%APPDATA%\9router
if exist "%YD_DATA%\db\data.sqlite" (
  if not exist "%APPDATA_9ROUTER%\db" mkdir "%APPDATA_9ROUTER%\db"
  copy /Y "%YD_DATA%\db\data.sqlite" "%APPDATA_9ROUTER%\db\data.sqlite" >nul
  echo Backup copied to %%APPDATA%%\9router
)

echo Starting 9Router v0.5.4 (production mode)...
echo Dashboard: http://localhost:20128
echo.
set PORT=20128
set NODE_ENV=production
set HOSTNAME=0.0.0.0
set DATA_DIR=%YD_DATA%
npm run start
pause
