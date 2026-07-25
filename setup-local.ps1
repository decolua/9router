# ============================================================
# 9Router — Быстрый старт (Windows)
# ============================================================
# Запуск: правой кнопкой → "Run with PowerShell" или:
#   powershell -ExecutionPolicy Bypass -File setup-local.ps1
# ============================================================

Write-Host "╔═══════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║       9Router — Локальная настройка          ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════════════════╝" -ForegroundColor Cyan

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# 1. Создаём .env если нет
$envFile = Join-Path $RootDir ".env"
if (-not (Test-Path $envFile)) {
    Write-Host "`n[1/4] Создаю .env..." -ForegroundColor Yellow
@"
# 9Router — Локальный режим
PROVIDER_OPENCODE_KEY=sk-NXEB55UHcYlQKkHe1F6Hto91CAMCphU5cC8rU609ZGbyMGAotYIaUztUdUHJhjf1
OLLAMA_BASE_URL=http://localhost:11434
PORT=20128
NODE_ENV=development
HOSTNAME=0.0.0.0
DATA_DIR=./data
JWT_SECRET=dentas70-local-9router-secret-2026
INITIAL_PASSWORD=123456
"@ | Set-Content -Path $envFile -Encoding UTF8
    Write-Host "  ✓ .env создан" -ForegroundColor Green
} else {
    Write-Host "`n[1/4] .env уже существует" -ForegroundColor Gray
}

Set-Location -Path $RootDir

# 2. Создаём папку data
Write-Host "[2/4] Создаю папку data..." -ForegroundColor Yellow
$dataDir = Join-Path $RootDir "data"
if (-not (Test-Path $dataDir)) {
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
    Write-Host "  ✓ data/ создана" -ForegroundColor Green
} else {
    Write-Host "  ✓ data/ уже существует" -ForegroundColor Gray
}

# 3. Запускаем seed-скрипт (БД создаётся при первом запуске сервера — seed-скрипт сам создаст БД если нужно)
Write-Host "[3/4] Настраиваю провайдеров (LM Studio, OpenRouter)..." -ForegroundColor Yellow
node scripts/setup-local.js
if ($?) {
    Write-Host "  ✓ Настройка завершена" -ForegroundColor Green
} else {
    Write-Host "  ✗ Ошибка настройки. Запустите сервер (npm run dev), подождите 10 секунд, затем:" -ForegroundColor Red
    Write-Host "    node scripts/setup-local.js" -ForegroundColor Yellow
}

# 4. Инструкция по запуску
Write-Host "[4/4] Готово!" -ForegroundColor Yellow

Write-Host "`n╔═══════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  ВСЁ ГОТОВО К ЗАПУСКУ!                      ║" -ForegroundColor Cyan
Write-Host "║                                              ║" -ForegroundColor Cyan
Write-Host "║  Запуск сервера:                             ║" -ForegroundColor White
Write-Host "║    npm run dev                              ║" -ForegroundColor White
Write-Host "║                                              ║" -ForegroundColor White
Write-Host "║  Дашборд:  http://localhost:20128            ║" -ForegroundColor White
Write-Host "║  API:      http://localhost:20128/v1         ║" -ForegroundColor White
Write-Host "║  Оркестр:  POST /api/orchestrator            ║" -ForegroundColor White
Write-Host "╚═══════════════════════════════════════════════╝" -ForegroundColor Cyan

Write-Host "`nКак это работает:" -ForegroundColor Yellow
Write-Host "  1. Любой OpenAI-совместимый клиент → http://localhost:20128/v1"
Write-Host "  2. Оркестратор сам определяет тип задачи и выбирает лучшую модель"
Write-Host "  3. Картинки → vision-модели (minimax-m3, qwen2.5vl)"
Write-Host "  4. Код → coder-модели (deepseek-v4-flash-free, qwen2.5-coder)"
Write-Host "  5. Мышление → reasoning-модели (deepseek, qwen)"
Write-Host "  6. Чат → round-robin по всем бесплатным моделям"
Write-Host "  7. Бесплатные модели приоритетнее платных" -ForegroundColor Green

Write-Host "`nПодключённые провайдеры:" -ForegroundColor Cyan
Write-Host "  ✓ OpenCode Free (без ключа): north-mini-code-free, deepseek-v4-flash-free, big-pickle, mimo-v2.5-free, nemotron-3-ultra-free" -ForegroundColor Green
Write-Host "  ✓ OpenCode Go (по ключу): deepseek-v4-pro, kimi-k2.7-code, glm-5.2, minimax-m3, qwen3.7-max" -ForegroundColor Green
Write-Host "  ✓ Ollama (авто): gemma4, qwen3.6, qwen2.5vl, gemma2, qwen2.5-coder" -ForegroundColor Green
Write-Host "  ✓ LM Studio (http://127.0.0.1:1234): ваши локальные модели" -ForegroundColor Green
Write-Host "  ✓ OpenRouter (sk-or-v1-...): 300+ моделей" -ForegroundColor Green

Write-Host "`nДля сброса: удалите папку data/ и запустите скрипт заново" -ForegroundColor Gray
