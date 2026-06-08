<#
.SYNOPSIS
  Установка 9Router как Windows Service через PM2 + Task Scheduler watchdog
.DESCRIPTION
  1. Устанавливает PM2 глобально (если нет)
  2. Создаёт папку для логов
  3. Регистрирует процесс в PM2
  4. Сохраняет PM2 список (для автозапуска)
  5. Добавляет задачу в Task Scheduler — проверка PM2 каждую минуту
  6. Запускает сервер
#>

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogsDir = Join-Path $ProjectRoot "logs"

Write-Host "=== 9Router Service Installer ===" -ForegroundColor Cyan
Write-Host "Project: $ProjectRoot" -ForegroundColor Gray

# 1. Папка логов
if (-not (Test-Path $LogsDir)) {
    New-Item -ItemType Directory -Path $LogsDir -Force | Out-Null
    Write-Host "[OK] Папка логов создана: $LogsDir" -ForegroundColor Green
}

# 2. Проверка/установка PM2
$pm2Path = Get-Command "pm2" -ErrorAction SilentlyContinue
if (-not $pm2Path) {
    Write-Host "[...] Устанавливаю PM2 глобально..." -ForegroundColor Yellow
    npm install -g pm2
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[FAIL] Ошибка установки PM2" -ForegroundColor Red
        exit 1
    }
    Write-Host "[OK] PM2 установлен" -ForegroundColor Green
} else {
    Write-Host "[OK] PM2 уже установлен: $($pm2Path.Source)" -ForegroundColor Green
}

# 3. Создание startup скрипта для Windows
Write-Host "[...] Регистрирую PM2 startup..." -ForegroundColor Yellow
pm2 startup -y 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "[OK] PM2 startup registered" -ForegroundColor Green
}

# 4. Остановить старый процесс если был
pm2 delete 9router 2>$null

# 5. Запуск через ecosystem.config.js
Write-Host "[...] Запускаю 9Router через PM2..." -ForegroundColor Yellow
pm2 start (Join-Path $ProjectRoot "ecosystem.config.js")
if ($LASTEXITCODE -ne 0) {
    Write-Host "[FAIL] Ошибка запуска PM2" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] 9Router запущен через PM2" -ForegroundColor Green

# 6. Сохраняем список PM2 (чтобы восстановился после перезагрузки)
Write-Host "[...] Сохраняю PM2 process list..." -ForegroundColor Yellow
pm2 save
if ($LASTEXITCODE -eq 0) {
    Write-Host "[OK] PM2 list сохранён" -ForegroundColor Green
}

# 7. Task Scheduler watchdog (проверка PM2 каждую минуту)
$TaskName = "9Router-Watchdog"
$TaskExists = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

$TaskAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -Command `"try { pm2 pid 9router 2>`$null | Out-Null; if (`$LASTEXITCODE -ne 0) { Write-Host 'PM2 9router not running, restarting...'; pm2 start (Join-Path '$ProjectRoot' 'ecosystem.config.js'); pm2 save } } catch { pm2 start (Join-Path '$ProjectRoot' 'ecosystem.config.js'); pm2 save }`""
$TaskTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$TaskPrincipal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$TaskSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

if ($TaskExists) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "[OK] Старая задача Task Scheduler удалена" -ForegroundColor Yellow
}

Register-ScheduledTask -TaskName $TaskName -Action $TaskAction -Trigger $TaskTrigger -Principal $TaskPrincipal -Settings $TaskSettings -Force
if ($?) {
    Write-Host "[OK] Task Scheduler watchdog создан (проверка каждую минуту)" -ForegroundColor Green
} else {
    Write-Host "[WARN] Не удалось создать Task Scheduler (возможно нет прав)" -ForegroundColor Yellow
    Write-Host "[WARN] Ручной запуск: pm2 start ecosystem.config.js" -ForegroundColor Yellow
}

# 8. Финальная проверка
Start-Sleep -Seconds 5
$pidNumber = pm2 pid 9router 2>$null
if ($pidNumber -and $pidNumber -gt 0) {
    Write-Host ""
    Write-Host "=== Установка завершена успешно! ===" -ForegroundColor Green
    Write-Host "Статус:    pm2 status" -ForegroundColor Cyan
    Write-Host "Логи:      pm2 logs 9router" -ForegroundColor Cyan
    Write-Host "Монитор:   pm2 monit" -ForegroundColor Cyan
    Write-Host "Сайт:      http://localhost:20128" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Сервер будет автоматически перезапускаться при падениях." -ForegroundColor White
    Write-Host "PM2 запускается при старте Windows (через startup)." -ForegroundColor White
    Write-Host "Task Scheduler проверяет PM2 каждую минуту (watchdog)." -ForegroundColor White
} else {
    Write-Host "[WARN] Процесс не обнаружен, проверь: pm2 status" -ForegroundColor Yellow
}