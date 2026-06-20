# 9Router — Russian Edition (Server)

Форк [decolua/9router](https://github.com/decolua/9router) с фокусом на **бесплатные провайдеры**, **авто-переключение** и **работу на сервере** (без Docker).

---

## Российская адаптация

Оригинал заточен под западного пользователя: Docker, Cloudflare, английский язык, недоступные в РФ способы оплаты. Наша версия:

- **RouterAI** — провайдер добавлен как native registry entry, работает через `https://routerai.ru/api/v1` без танцев с бубном
- **Cloudflare отключён** — регион-блок (403), ключи не работают. Бесполезен для РФ
- **OpenCode Free** — endpoint исправлен на `opencode.ai/zen/v1` (работающий)
- **Бесплатные провайдеры по умолчанию** — список тестовых моделей заточен под РФ-доступные
- **Донат** — ЮMoney (Яндекс.Деньги), T-Bank, Boosty, USDT. Вместо недоступного Stripe/Patreon
- **seed-providers.js** — исправлены provider ID: `cloudflare` → `cloudflare-ai`, `vercel` → `vercel-ai-gateway`
- **registry/index.js** — восстановлен export-массив (был обрезан, не импортировались grok-web и другие)
- **Kiro AI** — снят флаг deprecated (всё ещё работает, бесплатный Claude 4.5)

---

## Оркестратор

Оркестратор — это система автоматического выбора моделей, пинга здоровья и накопления статистики. То, чего в оригинале нет вообще.

### Как это работает

```
Пинг всех провайдеров → запись результатов в SQLite → рейтинг моделей
         ↓                     ↓                            ↓
   health check       переживает рестарт           tier A/B/C/D
   на дашборде                                     (скорость + надёжность)
```

### Команды

| Метод | Endpoint | Что делает |
|-------|----------|------------|
| `POST` | `/api/orchestrator/ping-all` | Пингует всех активных провайдеров с их моделями. Записывает latency, статус, ошибки в `usageHistory` и результат в `kv` таблицу. Concurrency 5, таймаут 30s на модель |
| `GET` | `/api/orchestrator` | Возвращает Health Check (статусы моделей: ✅/❌), конфигурацию ModelRouter, настройки супервизора, список воркфлоу |
| `GET` | `/api/orchestrator/stats?period=7d` | Накопительная статистика: рейтинг моделей, успешность, latency, количество токенов |
| `GET` | `/api/orchestrator/discover` | Auto-discovery моделей Ollama (локальные) |

### Free-first priority chain

При пинге модели сортируются по приоритету: **сначала бесплатные, потом платные (резерв)**.

```
1. OpenCode Free   — 6 моделей, стабильно 0.4-6s
2. Ollama          — локальные + облачные, 7 моделей
3. LM Studio       — локальные, 2 модели
4. RouterAI        — deepseek (резерв, условно-бесплатный)
5. OpenRouter      — платный (только если всё остальное упало)
```

### Авто-скип проблемных моделей

Если модель упала 3 раза подряд с timeout — она автоматически исключается из следующих пингов, пока не ответит успешно. Счётчик хранится в глобальной памяти (не сбрасывается между запросами).

---

## Health Check и рейтинг моделей

Каждый `ping-all` записывает в `usageHistory`:
- название модели и провайдера
- статус (`ok` / `error`)
- latency в миллисекундах
- текст ошибки (если была)

**Реальное использование тоже записывается** — когда ты через 9Router отправляешь запрос к модели, `saveRequestUsage()` сохраняет токены, статус, cost в ту же таблицу. Статистика собирается и с пингов, и с реальной работы.

Рейтинг модели считается по формуле:

```
reliability = successRate × 0.6
speed       = max(0, 100 - (latency - 200) / 30) × 0.4
overall     = reliability + speed

Tier A: 90+  — быстрые и стабильные
Tier B: 75+  — надёжные, но медленнее
Tier C: 50+  — работают, но с ограничениями
Tier D: <50  — проблемные (частые ошибки, таймауты)
```

Пример вывода:

```
Tier  MODEL                     RATE  LATENCY   SCORE
A     north-mini-code-free      100%  564ms     95
A     minimax-m2.5:cloud        100%  708ms     94
A     gemma4:31b-cloud          100%  789ms     92
B     deepseek-v4-flash-free    100%  1577ms    82
C     qwen2.5-coder:7b          100%  8737ms    60
D     gemma2:9b                 0%    ---       20
```

Параметр `?period=7d` / `30d` / `all` фильтрует данные по дате записи.

---

## Установка на сервер (без Docker)

### Linux (одной командой)

```bash
curl -fsSL https://raw.githubusercontent.com/mdn77/9router-russian/master/quick-start.sh | sudo bash
```

Скрипт сам установит Node.js, склонирует репозиторий, соберёт проект, создаст systemd unit с автозапуском.

### Windows

```bash
git clone https://github.com/mdn77/9router-russian.git
cd 9router-russian
quick-start.bat
```

Скрипт установит зависимости, соберёт проект, запустит сервер и добавит его в автозагрузку Windows.

### Вручную

```bash
git clone https://github.com/mdn77/9router-russian.git
cd 9router-russian
npm install
npm run build

# Production
export NODE_ENV=production
export PORT=20128
export HOSTNAME=0.0.0.0
export DATA_DIR=/var/lib/9router
export JWT_SECRET=$(openssl rand -hex 32)
export INITIAL_PASSWORD=admin
npm run start
```

### systemd unit (Linux)

```ini
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
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable 9router
sudo systemctl start 9router
```

---

## Бесплатные провайдеры (из коробки)

| Провайдер | Модели | Как подключить |
|-----------|--------|----------------|
| **OpenCode Free** | north-mini-code, deepseek-v4-flash-free, nemotron-3-ultra | Просто включить — без ключа |
| **Ollama Local** | qwen2.5vl, qwen2.5-coder, gemma4 | Установить Ollama, запустить модели |
| **Ollama Cloud** | minimax-m3, nemotron-3-super, gemma4:31b, gpt-oss:120b, minimax-m2.5 | Работают через локальный Ollama-proxy |
| **LM Studio** | gemma-4-e4b, llama-3.2 | Запустить LM Studio, включить сервер |
| **RouterAI** | deepseek/deepseek-v4-flash | Добавить API ключ в настройках |
| **Kiro AI** (OAuth) | Claude Sonnet 4.5, GLM-5, MiniMax, DeepSeek 3.2 | Connect → AWS Builder ID / Google / GitHub |
| **Vertex AI** (GCP) | Gemini 3.1 Pro, Gemini 3 Flash | Загрузить Service Account JSON |

---

## Поддержать проект

Если форк пригодился — можно сказать спасибо.

Способы для РФ: T-Bank, ЮMoney, USDT (TRC20), Boosty.

Реквизиты в описании последнего релиза:
https://github.com/mdn77/9router-russian/releases
