# 9Router — Русская версия (Server Edition)

**Русскоязычный форк** [decolua/9router](https://github.com/decolua/9router) с фокусом на бесплатные провайдеры, авто-переключение, рейтинг моделей и лёгкий запуск на сервере. Без Docker.

---

## 🇷🇺 Чем отличается от оригинала

| Оригинал | Эта версия |
|----------|-----------|
| Docker-first | **Запуск на сервере** — systemd, PM2, или напрямую |
| Нет оркестратора | **Оркестратор**: ping-all, рейтинг, health check |
| Нет RouterAI | **RouterAI** как встроенный провайдер |
| Cloudflare по умолчанию | **Отключён** (регион-блок) |
| Ping-all в KV store | **В SQLite** — переживает перезагрузку |
| Нет рейтинга | **Рейтинг A/B/C/D** по скорости и надёжности |
| Донат через Stripe/Patreon | **ЮMoney** для РФ, оригинал для остальных |
| Английский язык | **Полный русский интерфейс**, инструкции на русском |

---

## 🚀 Быстрый старт

### Linux (одной командой)

```bash
curl -fsSL https://raw.githubusercontent.com/mdn77/9router-russian/master/quick-start.sh | sudo bash
```

Скрипт: установит Node.js → склонирует → соберёт → создаст systemd → запустит.

### Windows (одной командой)

```bat
git clone https://github.com/mdn77/9router-russian.git
cd 9router-russian
quick-start.bat
```

Скрипт: установит зависимости → соберёт → запустит → добавит в автозагрузку.

### Docker (для продакшена, не для Windows)

```bash
docker build -t 9router-russian .
docker run -d \
  --name 9router \
  -p 20128:20128 \
  -v /var/lib/9router:/app/data \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET=$(openssl rand -hex 32) \
  -e INITIAL_PASSWORD=admin \
  -e PORT=20128 \
  9router-russian
```

> ⚠️ **На Windows Docker не запускайте** — крашит компьютер из-за WSL2 memory leak. Используйте `quick-start.bat`.

---

## 📦 Установка пошагово

### Linux (вручную)

```bash
# 1. Установить Node.js 22+
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt-get install -y nodejs

# 2. Клонировать
git clone https://github.com/mdn77/9router-russian.git /opt/9router
cd /opt/9router

# 3. Установить и собрать
npm install
npm run build

# 4. Настроить
cat > .env <<EOF
NODE_ENV=production
PORT=20128
HOSTNAME=0.0.0.0
DATA_DIR=/var/lib/9router
JWT_SECRET=$(openssl rand -hex 32)
INITIAL_PASSWORD=admin
EOF

# 5. Запустить
npm run start
```

Дашборд: http://localhost:20128  
API: http://localhost:20128/v1  
Пароль: admin

### systemd (автозапуск)

```bash
sudo tee /etc/systemd/system/9router.service > /dev/null <<'UNIT'
[Unit]
Description=9Router — FREE AI Router (Russian Edition)
After=network-online.target

[Service]
Type=exec
User=root
WorkingDirectory=/opt/9router
Environment=NODE_ENV=production
Environment=PORT=20128
Environment=HOSTNAME=0.0.0.0
Environment=DATA_DIR=/var/lib/9router
ExecStart=/usr/bin/node /opt/9router/node_modules/.bin/next start --port 20128
Restart=always
RestartSec=10
MemoryMax=2G

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable 9router
sudo systemctl start 9router
sudo journalctl -u 9router -f  # смотреть логи
```

### PM2 (альтернатива systemd)

```bash
npm install -g pm2
pm2 start npm --name 9router -- start
pm2 save
pm2 startup
```

### Windows (вручную)

```bat
git clone https://github.com/mdn77/9router-russian.git C:\9router
cd C:\9router
npm install
npm run build

REM Запуск:
npm run start

REM Автозагрузка:
copy start-server.bat "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\"
```

---

## 🆓 Бесплатные провайдеры

Все модели в таблице — **бесплатные**, работают без подписки.

| Провайдер | Модели | Как подключить |
|-----------|--------|----------------|
| **OpenCode Free** | north-mini-code, deepseek-v4-flash-free, nemotron-3-ultra | Просто включить — без ключа |
| **Ollama Local** | qwen2.5vl:7b, qwen2.5-coder:7b, gemma4 | Установить [Ollama](https://ollama.com) |
| **Ollama Cloud** | minimax-m3, nemotron-3-super, gemma4:31b, gpt-oss:120b, minimax-m2.5 | Работают через локальный Ollama |
| **LM Studio** | gemma-4-e4b, llama-3.2 | Запустить [LM Studio](https://lmstudio.ai) |
| **RouterAI** | deepseek/deepseek-v4-flash | Добавить API ключ в настройках |
| **Kiro AI** | Claude Sonnet 4.5, GLM-5, MiniMax, DeepSeek 3.2 | OAuth через AWS Builder ID / Google / GitHub |
| **Vertex AI** | Gemini 3.1 Pro, Gemini 3 Flash | Загрузить Service Account из GCP ($300 кредит) |

---

## 🎛️ Оркестратор

Автоматический пинг, выбор и переключение моделей.

### Команды

| Метод | Endpoint | Описание |
|-------|----------|----------|
| **POST** | `/api/orchestrator/ping-all` | Пинг всех провайдеров. Запись latency, статуса, ошибок в SQLite |
| **GET** | `/api/orchestrator` | Health Check: статусы моделей ✅❌, конфигурация роутера |
| **GET** | `/api/orchestrator/stats?period=7d` | Накопительная статистика: рейтинг моделей (A/B/C/D) |
| **GET** | `/api/orchestrator/discover` | Auto-discovery локальных моделей Ollama |

### Free-first priority chain

При пинге и выборе моделей приоритет:

```
1. OpenCode Free       — без ключа, стабильно
2. Ollama (local+cloud) — локальные и облачные
3. LM Studio           — локальные
4. RouterAI            — резерв (deepseek)
5. OpenRouter          — платный (только если всё упало)
```

### Авто-скип проблемных моделей

Если модель упала 3 раза подряд с timeout — автоматически исключается из пингов, пока не ответит успешно.

---

## 📊 Рейтинг моделей

Каждый ping-all записывает в `usageHistory` latency и статус.  
Реальное использование тоже записывается — через `saveRequestUsage()`.

**Формула рейтинга:**

```
reliability = successRate × 0.6
speed       = max(0, 100 - (latency - 200) / 30) × 0.4
overall     = reliability + speed

Tier A: 90+  — быстрые и стабильные
Tier B: 75+  — надёжные
Tier C: 50+  — работают с ограничениями
Tier D: <50  — проблемные
```

**Пример вывода:**
```
Tier  MODEL                     RATE  LATENCY   SCORE
A     north-mini-code-free      100%  564ms     95
A     minimax-m2.5:cloud        100%  708ms     94
B     deepseek-v4-flash-free    100%  1577ms    82
C     qwen2.5-coder:7b          100%  8737ms    60
D     gemma2:9b                 0%    ---       20
```

Параметр `?period=7d` / `30d` / `all` фильтрует по дате.

---

## 🛠️ Ответы на вопросы

**Q: Docker крашит компьютер**  
A: На Windows не используйте Docker для этого проекта — WSL2 жрёт всю память. Используйте `quick-start.bat`.

**Q: Какие модели бесплатные?**  
A: Все в таблице выше. OpenCode Free, Ollama (local + cloud), LM Studio — вообще без ключей. RouterAI требует бесплатный ключ.

**Q: Как добавить Kiro AI?**  
A: Dashboard → Providers → Connect Kiro → выберите AWS Builder ID / Google / GitHub OAuth.

**Q: Статистика не обновляется**  
A: Запустите `POST /api/orchestrator/ping-all` через дашборд или curl.

**Q: OpenRouter модели не работают**  
A: OpenRouter требует пополнения баланса даже для `:free` моделей. Отключите в настройках, если не пользуетесь.

**Q: Не вижу Health Check в дашборде**  
A: Health Check заполняется после первого ping-all. Нажмите кнопку "Прозвонить всё" на странице Orchestrator.

---

## 📜 История изменений

См. [CHANGELOG.md](CHANGELOG.md) (на английском) и коммиты в репозитории.

---

## ❤️ Поддержать проект

Если хотите сказать спасибо:

**РФ:** ЮMoney — кнопка Donate в правом верхнем углу дашборда (появляется, если нет доступа к 9router.com)

**За границей:** Patreon / GitHub — кнопка Donate в дашборде
