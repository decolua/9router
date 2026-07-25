@echo off
chcp 65001 > nul
title 9Router Quick Start — Windows

echo === 9Router Quick Start (Windows) ===
echo.

:: 1. Check Node.js
where node >nul 2>&1 || (
  echo [ОШИБКА] Node.js не найден!
  echo Скачайте и установите: https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi
  pause
  exit /b 1
)
echo [OK] Node.js найден

:: 2. Check git
where git >nul 2>&1 || (
  echo [ОШИБКА] Git не найден!
  echo Скачайте и установите: https://git-scm.com/download/win
  pause
  exit /b 1
)
echo [OK] Git найден

:: 3. Choose install dir
set INSTALL_DIR=%USERPROFILE%\9router
set DATA_DIR=%APPDATA%\9router
set PORT=20128

:: 4. Clone
if exist "%INSTALL_DIR%" (
  echo [*] Обновление существующей установки...
  cd /d "%INSTALL_DIR%"
  git pull
) else (
  echo [*] Клонирование репозитория...
  git clone https://github.com/mdn77/9router-russian.git "%INSTALL_DIR%"
  cd /d "%INSTALL_DIR%"
)

:: 5. npm install + build
echo [*] Установка зависимостей...
call npm install
echo [*] Сборка...
call npm run build

:: 6. .env
echo NODE_ENV=production> .env
echo PORT=%PORT%>> .env
echo HOSTNAME=0.0.0.0>> .env
echo DATA_DIR=%DATA_DIR%>> .env
echo JWT_SECRET=local-%RANDOM%-%RANDOM%-%RANDOM%>> .env
echo INITIAL_PASSWORD=admin>> .env

:: 7. Create start script
echo @echo off > start-server.bat
echo chcp 65001 ^> nul >> start-server.bat
echo cd /d "%INSTALL_DIR%" >> start-server.bat
echo echo [9Router] Starting on http://localhost:%PORT% >> start-server.bat
echo npm run start >> start-server.bat

:: 8. Create shortcut for autostart
set AUTOSTART_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
echo @echo off > "%AUTOSTART_DIR%\9router.bat"
echo cd /d "%INSTALL_DIR%" >> "%AUTOSTART_DIR%\9router.bat"
echo start /B /MIN npm run start >> "%AUTOSTART_DIR%\9router.bat"

echo.
echo ============================================
echo  9Router установлен!
echo.
echo  Dashboard: http://localhost:%PORT%
echo  API:       http://localhost:%PORT%/v1
echo  Пароль:    admin
echo.
echo  Запуск:    %INSTALL_DIR%\start-server.bat
echo  Автозапуск: добавлен в автозагрузку
echo ============================================
echo.

:: 9. Start now
start "9Router" cmd /c "%INSTALL_DIR%\start-server.bat"
timeout /t 5
start http://localhost:%PORT%

pause
