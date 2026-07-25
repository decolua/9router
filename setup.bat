@echo off
chcp 65001 >nul
title 9router Russian — Автоустановка
color 0A

echo ╔══════════════════════════════════════════╗
echo ║    🚀 9router Russian Auto Setup         ║
echo ║    Одно-кликовое развёртывание           ║
echo ╚══════════════════════════════════════════╝
echo.

:: ═════════════════════════════════════════════
:: ШАГ 1: Поиск хранилища с ключами
:: ═════════════════════════════════════════════
echo [1/6] 🔑 Поиск хранилища с ключами...
echo.
echo    Укажи путь к папке '9router-secrets', где лежат:
echo      • .env — с API-ключами (OpenAI, Claude и др.)
echo      • providers\*.json — файлы провайдеров
echo.
echo    Папка может лежать где угодно: Яндекс.Диск, Google Drive,
echo    Dropbox, USB-флешка, сетевая папка — что удобно.
echo    Просто скопируй её на новый комп и укажи путь.
echo.

:: Проверяем переменную окружения (можно задать заранее)
if "%SECRETS_STORAGE%"=="" goto :find_default

if exist "%SECRETS_STORAGE%\9router-secrets" (
    set SECRETS_DIR=%SECRETS_STORAGE%\9router-secrets
    echo [✅] Используется SECRETS_STORAGE: %SECRETS_DIR%
    goto :step2
)
if exist "%SECRETS_STORAGE%" (
    set SECRETS_DIR=%SECRETS_STORAGE%
    echo [✅] Используется SECRETS_STORAGE: %SECRETS_DIR%
    goto :step2
)

:find_default
:: Ищем в облачных хранилищах
set SECRETS_DIR=
if exist "%USERPROFILE%\Yandex.Disk\9router-secrets\.env" set SECRETS_DIR=%USERPROFILE%\Yandex.Disk\9router-secrets
if "%SECRETS_DIR%"=="" if exist "%USERPROFILE%\Google Drive\9router-secrets\.env" set SECRETS_DIR=%USERPROFILE%\Google Drive\9router-secrets
if "%SECRETS_DIR%"=="" if exist "%USERPROFILE%\My Drive\9router-secrets\.env" set SECRETS_DIR=%USERPROFILE%\My Drive\9router-secrets
if "%SECRETS_DIR%"=="" if exist "%USERPROFILE%\Dropbox\9router-secrets\.env" set SECRETS_DIR=%USERPROFILE%\Dropbox\9router-secrets
if "%SECRETS_DIR%"=="" if exist "%USERPROFILE%\9router-secrets\.env" set SECRETS_DIR=%USERPROFILE%\9router-secrets

if not "%SECRETS_DIR%"=="" (
    echo [✅] Найдена папка с ключами: %SECRETS_DIR%
    goto :step2
)

:: Спрашиваем у пользователя
echo [⚠️] Папка '9router-secrets' не найдена автоматически.
echo      Укажи путь к ней вручную.
echo.
echo      Это может быть: Яндекс.Диск / Google Drive / USB-флешка / сетевая папка
echo.
set /p SECRETS_DIR="Путь к папке 9router-secrets (Enter чтобы пропустить): "

if "%SECRETS_DIR%"=="" (
    echo [!] Пропускаем импорт ключей.
    goto :step2
)

if not exist "%SECRETS_DIR%" (
    echo [❌] Папка не найдена: %SECRETS_DIR%
    echo [!] Пропускаем импорт ключей.
    set SECRETS_DIR=
)
goto :step2

:step2_show
if not "%SECRETS_DIR%"=="" (
    echo [✅] Папка с ключами: %SECRETS_DIR%
    echo    Содержимое:
    dir "%SECRETS_DIR%" 2>nul
)

:: ═════════════════════════════════════════════
:: ШАГ 2: Копирование .env
:: ═════════════════════════════════════════════
:step2
echo.
echo [2/6] 📝 Копирование .env...

if exist "%SECRETS_DIR%\.env" (
    copy /Y "%SECRETS_DIR%\.env" ".env" >nul
    echo [✅] .env скопирован из хранилища ключей
) else (
    if not exist ".env" (
        if exist ".env.example" (
            copy /Y ".env.example" ".env" >nul
            echo [⚠️] .env не найден, создан из .env.example
            echo      Отредактируй .env и добавь свои API-ключи!
        ) else (
            echo [❌] .env не найден! Создай .env вручную.
        )
    ) else (
        echo [✅] .env уже существует
    )
)

:: ═════════════════════════════════════════════
:: ШАГ 3: Проверка Docker
:: ═════════════════════════════════════════════
:step3
echo.
echo [3/6] 🐳 Проверка Docker...

docker info >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [❌] Docker не запущен или не установлен!
    echo      Установи Docker Desktop: https://www.docker.com/products/docker-desktop/
    echo      Или запусти Docker вручную.
    pause
    exit /b 1
)
echo [✅] Docker работает

:: ═════════════════════════════════════════════
:: ШАГ 4: Сборка и запуск контейнера
:: ═════════════════════════════════════════════
:step4
echo.
echo [4/6] 🏗️ Сборка и запуск 9router...

:: Остановить старый контейнер если есть
docker-compose down 2>nul

:: Создаём директории для данных
if not exist "data" mkdir data
if not exist "data-home" mkdir data-home

:: Запускаем
docker-compose up -d --build 2>&1 | findstr /V "network"
if %ERRORLEVEL% NEQ 0 (
    echo [❌] Ошибка при запуске Docker!
    pause
    exit /b 1
)
echo [✅] 9router запущен

:: Ждём готовности
echo.
echo [⏳] Ожидание готовности 9router (до 30 секунд)...
set /a COUNTER=0
:wait_loop
timeout /t 3 /nobreak >nul
set /a COUNTER+=1
curl -s -o nul -w "%%{http_code}" http://localhost:20128/ 2>nul | findstr "200 301 302 401" >nul
if %ERRORLEVEL% NEQ 0 (
    if %COUNTER% LSS 10 goto :wait_loop
    echo [⚠️] 9router не отвечает. Проверь логи: docker-compose logs
) else (
    echo [✅] 9router готов на http://localhost:20128
)

:: ═════════════════════════════════════════════
:: ШАГ 5: Импорт провайдеров с Яндекс.Диска
:: ═════════════════════════════════════════════
:step5
echo.
echo [5/6] 🔌 Импорт провайдеров...

if exist "%SECRETS_DIR%\providers\" (
    echo Импорт JSON-провайдеров из %SECRETS_DIR%\providers\
    
    for %%f in ("%SECRETS_DIR%\providers\*.json") do (
        echo    Загрузка: %%~nxf
        curl -s -X POST "http://localhost:20128/api/providers/connection" ^
            -H "Content-Type: application/json" ^
            -d @%%f >nul 2>&1
        
        if !ERRORLEVEL! EQU 0 (
            echo    [✅] %%~nf импортирован
        ) else (
            echo    [⚠️] Ошибка импорта %%~nf
        )
    )
    echo [✅] Провайдеры импортированы
) else (
    if exist "%SECRETS_DIR%" (
        echo [ℹ️] Папка providers\ не найдена в %SECRETS_DIR%
        echo      Импорт провайдеров пропущен
    )
    
    :: Пробуем найти JSON-файлы провайдеров локально
    if exist "add-ollama.json" (
        echo    Импорт локального провайдера: add-ollama.json
        curl -s -X POST "http://localhost:20128/api/providers/connection" ^
            -H "Content-Type: application/json" ^
            -d @add-ollama.json >nul 2>&1
    )
)

:: ═════════════════════════════════════════════
:: ШАГ 6: Итог
:: ═════════════════════════════════════════════
:step6
echo.
echo ╔══════════════════════════════════════════╗
echo ║    🎉 9router RUSSIAN ЗАПУЩЕН!          ║
echo ╠══════════════════════════════════════════╣
echo ║  📋 Сайт:    http://localhost:20128      ║
echo ║  🔑 API:     http://localhost:20128/api/v1 ║
echo ║  🐳 Docker:  9router (Up)               ║
echo ╚══════════════════════════════════════════╝
echo.
echo Полезные команды:
echo   docker-compose logs -f    — логи
echo   docker-compose down       — остановить
echo   docker-compose up -d      — перезапустить
echo   node autonomous/swarm-master.js "задача" — ИИ-оркестратор
echo.
echo 📁 Ключи хранятся в: %SECRETS_DIR%
echo   (скопируй эту папку на новый комп и укажи путь при установке)
echo.
pause