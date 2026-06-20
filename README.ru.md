# 9Router — Russian Edition (Server)

Форк [decolua/9router](https://github.com/decolua/9router) с фокусом на **бесплатные провайдеры**, **авто-переключение** и **работу на сервере** (без Docker).

## Чем отличается

| Оригинал | Наша версия |
|----------|-------------|
| Docker-first | Запуск через systemd / `npm run start` |
| Нет оркестратора | `/api/orchestrator/ping-all`, `discover`, `stats`, `route` |
| Нет RouterAI | Встроен как native провайдер (routerai.ru) |
| Cloudflare по умолчанию | Отключён (регион-блок) |
| Ping-all в KV store | В SQLite — переживает рестарт |
| Нет рейтинга моделей | Накопительная статистика с tier A/B/C/D |
| grok-web не подключен | Исправлен registry/index.js |
| `seed-providers.js` с `cloudflare`/`vercel` | Исправлено на `cloudflare-ai`/`vercel-ai-gateway` |

## Установка на сервер (без Docker)

```bash
git clone https://github.com/YOUR_USER/9router.git
cd 9router
npm install
npm run build

# Production
export NODE_ENV=production
export PORT=20128
export HOSTNAME=0.0.0.0
export DATA_DIR=/var/lib/9router
export JWT_SECRET=<generate-random>
export INITIAL_PASSWORD=<your-password>
npm run start
```

### systemd unit

```
[Unit]
Description=9Router — FREE AI Router
After=network-online.target

[Service]
Type=exec
User=9router
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
```

## Бесплатные провайдеры (из коробки)

| Провайдер | Модели | Тип |
|-----------|--------|-----|
| **OpenCode Free** | north-mini-code, deepseek-v4-flash-free, nemotron-3-ultra | API, без ключа |
| **Ollama Local** | qwen2.5vl, qwen2.5-coder, gemma4 | Локально |
| **Ollama Cloud** | minimax-m3, nemotron-3-super, gemma4:31b, gpt-oss:120b, minimax-m2.5 | API |
| **LM Studio** | gemma-4-e4b, llama-3.2 | Локально |
| **RouterAI** | deepseek/deepseek-v4-flash | API (резерв) |
| **Kiro AI** (OAuth) | Claude Sonnet 4.5, GLM-5, MiniMax | OAuth, бесплатно |
| **Vertex AI** (GCP) | Gemini 3.1 Pro, Gemini 3 Flash | $300 credit |

## Оркестратор

Автоматический выбор и переключение моделей:

- **`POST /api/orchestrator/ping-all`** — пинг всех провайдеров, запись в SQLite
- **`GET /api/orchestrator/stats?period=7d`** — накопительный рейтинг моделей (tier A/B/C/D)
- **`GET /api/orchestrator`** — Health Check, статусы моделей, настройки

Приоритет: бесплатные → платные (free-first chain).

## Health Check

Каждый ping-all записывает latency и статус в `usageHistory`.
REST API `/api/orchestrator/stats` агрегирует:

- Процент успешных запросов
- Среднюю задержку
- Количество токенов
- Общий рейтинг: A (90+) / B (75+) / C (50+) / D (<50)

Данные накапливаются в SQLite и переживают перезагрузку сервера.
