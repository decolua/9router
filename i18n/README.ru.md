<div align="center">
  <img src="../images/9router.png?1" alt="Панель управления 9Router" width="800"/>
  
  # 9Router - Free AI Router
  
  **Никогда не прекращайте кодить. Автоматическая маршрутизация к БЕСПЛАТНЫМ и дешёвым AI-моделям с умным механизмом резервирования.**
  
  **Бесплатный AI-провайдер для OpenClaw.**
  
  <p align="center">
    <img src="../public/providers/openclaw.png" alt="OpenClaw" width="80"/>
  </p>
  
  [![npm](https://img.shields.io/npm/v/9router.svg)](https://www.npmjs.com/package/9router)
  [![Downloads](https://img.shields.io/npm/dm/9router.svg)](https://www.npmjs.com/package/9router)
  [![License](https://img.shields.io/npm/l/9router.svg)](https://github.com/decolua/9router/blob/main/LICENSE)
  
  [🚀 Быстрый старт](#-quick-start) • [💡 Возможности](#-key-features) • [📖 Установка](#-setup-guide) • [🌐 Сайт](https://9router.com)
</div>

---

## 🤔 Почему 9Router?

**Перестаньте тратить деньги и упираться в лимиты:**

- ❌ Квота подписки сгорает каждый месяц, не будучи израсходованной
- ❌ Ограничение скорости (rate limit) прерывает вас прямо во время работы
- ❌ Дорогие API ($20-50/мес за каждого провайдера)
- ❌ Приходится вручную переключаться между провайдерами

**9Router решает это:**

- ✅ **Максимум из подписки** — Отслеживает квоту, использует каждый бит до сброса
- ✅ **Автоматическое резервирование** — Подписка → Дёшево → Бесплатно, нулевой простой
- ✅ **Несколько аккаунтов** — Round-robin по аккаунтам каждого провайдера
- ✅ **Универсальность** — Работает с Claude Code, Codex, Gemini CLI, Cursor, Cline, любым CLI-инструментом

---

## 🔄 Как это работает

```
┌─────────────┐
│  Your CLI   │  (Claude Code, Codex, Gemini CLI, OpenClaw, Cursor, Cline...)
│   Tool      │
└──────┬──────┘
       │ http://localhost:20128/v1
       ↓
┌────────────────────────────────────────┐
│           9Router (Smart Router)        │
│  • Format translation (OpenAI ↔ Claude) │
│  • Quota tracking                       │
│  • Auto token refresh                   │
└──────┬──────────────────────────────────┘
       │
       ├─→ [Tier 1: SUBSCRIPTION] Claude Code, Codex, Gemini CLI
       │   ↓ quota exhausted
       ├─→ [Tier 2: CHEAP] GLM ($0.6/1M), MiniMax ($0.2/1M)
       │   budget limit
       └─→ [Tier 3: FREE] iFlow, Qwen, Kiro (unlimited)

Result: Never stop coding, minimal cost
```

---

## ⚡ Быстрый старт

**1. Глобальная установка:**

```bash
npm install -g 9router
9router
```

🎉 Панель управления откроется на `http://localhost:20128`

**2. Подключите БЕСПЛАТНОГО провайдера (без подписки):**

Панель управления → Providers → Подключить **Claude Code** или **Antigravity** → Вход через OAuth → Готово!

**3. Используйте в вашем CLI-инструменте:**

```
Настройки Claude Code/Codex/Gemini CLI/OpenClaw/Cursor/Cline:
  Endpoint: http://localhost:20128/v1
  API Key: [скопируйте из панели управления]
  Model: if/kimi-k2-thinking
```

**Готово!** Начинайте кодить с БЕСПЛАТНЫМИ AI-моделями.

**Альтернатива: запуск из исходников (этот репозиторий):**

Пакет этого репозитория приватный (`9router-app`), поэтому запуск из исходников/Docker — это ожидаемый путь локальной разработки.

```bash
cp .env.example .env
npm install
PORT=20128 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run dev
```

Режим Production:

```bash
npm run build
PORT=20128 HOSTNAME=0.0.0.0 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run start
```

URL по умолчанию:
- Панель управления: `http://localhost:20128/dashboard`
- OpenAI-совместимый API: `http://localhost:20128/v1`

---

## 🎥 Видео-руководство

<div align="center">
  
### 📺 Полное руководство по настройке - 9Router + Claude Code БЕСПЛАТНО
  
[![Настройка 9Router + Claude Code](https://img.youtube.com/vi/raEyZPg5xE0/maxresdefault.jpg)](https://www.youtube.com/watch?v=raEyZPg5xE0)

**🎬 Полное пошаговое руководство:**
- ✅ Установка и настройка 9Router
- ✅ Настройка Claude Sonnet 4.5 БЕСПЛАТНО
- ✅ Интеграция с Claude Code
- ✅ Тестирование кода вживую

**⏱️ Длительность:** 20 минут | **👥 Автор:** Сообщество разработчиков

[▶️ Смотреть на YouTube](https://www.youtube.com/watch?v=o3qYCyjrFYg)

</div>

---

## 🛠️ Поддерживаемые CLI-инструменты

9Router бесшовно работает со всеми основными AI-инструментами для кодинга:

<div align="center">
  <table>
    <tr>
      <td align="center" width="120">
        <img src="../public/providers/claude.png" width="60" alt="Claude Code"/><br/>
        <b>Claude-Code</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/openclaw.png" width="60" alt="OpenClaw"/><br/>
        <b>OpenClaw</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/codex.png" width="60" alt="Codex"/><br/>
        <b>Codex</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/opencode.png" width="60" alt="OpenCode"/><br/>
        <b>OpenCode</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/cursor.png" width="60" alt="Cursor"/><br/>
        <b>Cursor</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/antigravity.png" width="60" alt="Antigravity"/><br/>
        <b>Antigravity</b>
      </td>
    </tr>
    <tr>
      <td align="center" width="120">
        <img src="../public/providers/cline.png" width="60" alt="Cline"/><br/>
        <b>Cline</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/continue.png" width="60" alt="Continue"/><br/>
        <b>Continue</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/droid.png" width="60" alt="Droid"/><br/>
        <b>Droid</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/roo.png" width="60" alt="Roo"/><br/>
        <b>Roo</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/copilot.png" width="60" alt="Copilot"/><br/>
        <b>Copilot</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/kilocode.png" width="60" alt="Kilo Code"/><br/>
        <b>Kilo Code</b>
      </td>
    </tr>
  </table>
</div>

---

## Поддерживаемые провайдеры

### 🔐 OAuth-провайдеры

<div align="center">
  <table>
    <tr>
      <td align="center" width="120">
        <img src="../public/providers/claude.png" width="60" alt="Claude Code"/><br/>
        <b>Claude-Code</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/antigravity.png" width="60" alt="Antigravity"/><br/>
        <b>Antigravity</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/codex.png" width="60" alt="Codex"/><br/>
        <b>Codex</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/github.png" width="60" alt="GitHub"/><br/>
        <b>GitHub</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/cursor.png" width="60" alt="Cursor"/><br/>
        <b>Cursor</b>
      </td>
    </tr>
  </table>
</div>

### 🆓 Бесплатные провайдеры

<div align="center">
  <table>
    <tr>
      <td align="center" width="150">
        <img src="../public/providers/iflow.png" width="70" alt="iFlow"/><br/>
        <b>iFlow AI</b><br/>
        <sub>8+ моделей • Без ограничений</sub>
      </td>
      <td align="center" width="150">
        <img src="../public/providers/qwen.png" width="70" alt="Qwen"/><br/>
        <b>Qwen Code</b><br/>
        <sub>3+ моделей • Без ограничений</sub>
      </td>
      <td align="center" width="150">
        <img src="../public/providers/gemini-cli.png" width="70" alt="Gemini CLI"/><br/>
        <b>Gemini CLI</b><br/>
        <sub>180K/мес БЕСПЛАТНО</sub>
      </td>
      <td align="center" width="150">
        <img src="../public/providers/kiro.png" width="70" alt="Kiro"/><br/>
        <b>Kiro AI</b><br/>
        <sub>Claude • Без ограничений</sub>
      </td>
    </tr>
  </table>
</div>

### 🔑 Провайдеры с API Key (40+)

<div align="center">
  <table>
    <tr>
      <td align="center" width="100">
        <img src="../public/providers/openrouter.png" width="50" alt="OpenRouter"/><br/>
        <sub>OpenRouter</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/glm.png" width="50" alt="GLM"/><br/>
        <sub>GLM</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/kimi.png" width="50" alt="Kimi"/><br/>
        <sub>Kimi</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/minimax.png" width="50" alt="MiniMax"/><br/>
        <sub>MiniMax</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/openai.png" width="50" alt="OpenAI"/><br/>
        <sub>OpenAI</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/anthropic.png" width="50" alt="Anthropic"/><br/>
        <sub>Anthropic</sub>
      </td>
    </tr>
    <tr>
      <td align="center" width="100">
        <img src="../public/providers/gemini.png" width="50" alt="Gemini"/><br/>
        <sub>Gemini</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/deepseek.png" width="50" alt="DeepSeek"/><br/>
        <sub>DeepSeek</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/groq.png" width="50" alt="Groq"/><br/>
        <sub>Groq</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/xai.png" width="50" alt="xAI"/><br/>
        <sub>xAI</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/mistral.png" width="50" alt="Mistral"/><br/>
        <sub>Mistral</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/perplexity.png" width="50" alt="Perplexity"/><br/>
        <sub>Perplexity</sub>
      </td>
    </tr>
    <tr>
      <td align="center" width="100">
        <img src="../public/providers/together.png" width="50" alt="Together"/><br/>
        <sub>Together AI</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/fireworks.png" width="50" alt="Fireworks"/><br/>
        <sub>Fireworks</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/cerebras.png" width="50" alt="Cerebras"/><br/>
        <sub>Cerebras</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/cohere.png" width="50" alt="Cohere"/><br/>
        <sub>Cohere</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/nvidia.png" width="50" alt="NVIDIA"/><br/>
        <sub>NVIDIA</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/siliconflow.png" width="50" alt="SiliconFlow"/><br/>
        <sub>SiliconFlow</sub>
      </td>
    </tr>
  </table>
  <p><i>...и более 20 других провайдеров, включая Nebius, Chutes, Hyperbolic и пользовательские OpenAI/Anthropic-совместимые эндпоинты</i></p>
</div>

---

## 💡 Ключевые возможности

| Возможность | Что делает | Почему это важно |
|---------|--------------|----------------|
| 🎯 **Smart 3-Tier Fallback** | Авто-маршрутизация: Подписка → Дёшево → Бесплатно | Никогда не прекращайте кодить, нулевой простой |
| 📊 **Отслеживание квоты в реальном времени** | Живой подсчёт токенов + обратный отсчёт до сброса | Максимум ценности из подписки |
| 🔄 **Трансляция форматов** | OpenAI ↔ Claude ↔ Gemini бесшовно | Работает с любым CLI-инструментом |
| 👥 **Поддержка нескольких аккаунтов** | Несколько аккаунтов на каждого провайдера | Балансировка нагрузки + резервирование |
| 🔄 **Авто-обновление токена** | OAuth-токены обновляются автоматически | Не нужно входить вручную заново |
| 🎨 **Пользовательские комбо** | Создавайте безграничные комбинации моделей | Настройте резервирование под себя |
| 📝 **Логирование запросов** | Режим отладки с полным логом запросов/ответов | Лёгкая диагностика проблем |
| 💾 **Облачная синхронизация** | Синхронизация конфигурации между устройствами | Одинаковые настройки везде |
| 📊 **Аналитика использования** | Отслеживание токенов, затрат, трендов во времени | Оптимизация расходов |
| 🌐 **Развёртывание где угодно** | Localhost, VPS, Docker, Cloudflare Workers | Гибкие варианты развёртывания |

<details>
<summary><b>📖 Подробности о возможностях</b></summary>

### 🎯 Smart 3-Tier Fallback

Создавайте комбо с автоматическим резервированием:

```
Combo: "my-coding-stack"
  1. cc/claude-opus-4-6        (ваша подписка)
  2. glm/glm-4.7               (дешёвый бэкап, $0.6/1M)
  3. if/kimi-k2-thinking       (бесплатное резервирование)

→ Автопереключение при исчерпании квоты или ошибке
```

### 📊 Отслеживание квоты в реальном времени

- Потребление токенов по каждому провайдеру
- Обратный отсчёт до сброса (5 часов, ежедневно, еженедельно)
- Оценка затрат для платных уровней
- Ежемесячный отчёт о расходах

### 🔄 Трансляция форматов

Бесшовная трансляция между форматами:
- **OpenAI** ↔ **Claude** ↔ **Gemini** ↔ **OpenAI Responses**
- Ваш CLI-инструмент отправляет формат OpenAI → 9Router транслирует → Провайдер получает родной формат
- Работает с любым инструментом, поддерживающим пользовательский эндпоинт OpenAI

### 👥 Поддержка нескольких аккаунтов

- Добавляйте несколько аккаунтов на каждого провайдера
- Round-robin или маршрутизация по приоритету автоматически
- Резервирование на следующий аккаунт при достижении квоты

### 🔄 Авто-обновление токена

- OAuth-токены автоматически обновляются до истечения срока
- Не нужна повторная ручная аутентификация
- Бесшовный опыт со всеми провайдерами

### 🎨 Пользовательские комбо

- Создавайте безграничные комбинации моделей
- Сочетайте уровни подписки, дешёвые и бесплатные
- Называйте комбо для удобного доступа
- Делитесь комбо между устройствами через облачную синхронизацию

### 📝 Логирование запросов

- Включите режим отладки для просмотра полного лога запросов/ответов
- Отслеживайте вызовы API, заголовки и payload
- Диагностируйте проблемы интеграции
- Экспортируйте логи для анализа

### 💾 Облачная синхронизация

- Синхронизация провайдеров, комбо и настроек между устройствами
- Автоматическая фоновая синхронизация
- Безопасное зашифрованное хранилище
- Доступ к настройкам откуда угодно

#### Заметки о облачном рантайме

- Приоритет серверным облачным переменным в production-окружении:
  - `BASE_URL` (внутренний callback URL, используемый планировщиком синхронизации)
  - `CLOUD_URL` (база эндпоинта облачной синхронизации)
- `NEXT_PUBLIC_BASE_URL` и `NEXT_PUBLIC_CLOUD_URL` по-прежнему поддерживаются для совместимости/UI, но серверный рантайм теперь приоритезирует `BASE_URL`/`CLOUD_URL`.
- Запросы облачной синхронизации теперь используют тайм-аут + fail-fast поведение, чтобы избежать зависания UI при недоступности DNS/облачной сети.

### 📊 Аналитика использования

- Отслеживание использования токенов по провайдеру и модели
- Оценка затрат и тренды расходов
- Ежемесячные отчёты и инсайты
- Оптимизация ваших AI-расходов

> **💡 ВАЖНО - Понимание «Затрат» на панели управления:**
> 
> «Затраты», показанные в Аналитике использования, предназначены **только для отслеживания и сравнения**. 
> Сам 9Router **никогда ничего не взимает** с вас. Вы платите напрямую провайдерам (если используете платные сервисы).
> 
> **Пример:** Если на панели показано «общие затраты $290» при использовании моделей iFlow, это представляет 
> сумму, которую вы заплатили бы при прямом использовании платного API. Ваши фактические затраты = **$0** (iFlow бесплатен без ограничений).
> 
> Считайте это «трекером экономии», показывающим, сколько вы экономите, используя бесплатные модели или 
> маршрутизацию через 9Router!

### 🌐 Развёртывание где угодно

- 💻 **Localhost** — По умолчанию, работает офлайн
- ☁️ **VPS/Cloud** — Общий доступ между устройствами
- 🐳 **Docker** — Развёртывание одной командой
- 🚀 **Cloudflare Workers** — Глобальная edge-сеть

</details>

---

## 💰 Обзор цен

| Уровень | Провайдер | Стоимость | Сброс квоты | Лучше всего для |
|------|----------|------|-------------|----------|
| **💳 ПОДПИСКА** | Claude Code (Pro) | $20/мес | 5ч + еженедельно | Уже подписаны |
| | Codex (Plus/Pro) | $20-200/мес | 5ч + еженедельно | Пользователи OpenAI |
| | Gemini CLI | **БЕСПЛАТНО** | 180K/мес + 1K/день | Для всех! |
| | GitHub Copilot | $10-19/мес | Ежемесячно | Пользователи GitHub |
| **💰 ДЁШЕВО** | GLM-4.7 | $0.6/1M | 10:00 ежедневно | Бюджетный бэкап |
| | MiniMax M2.1 | $0.2/1M | Скользящие 5 часов | Самый дешёвый вариант |
| | Kimi K2 | $9/мес фикс. | 10M токенов/мес | Предсказуемая стоимость |
| **🆓 БЕСПЛАТНО** | iFlow | $0 | Без ограничений | 8 бесплатных моделей |
| | Qwen | $0 | Без ограничений | 3 бесплатные модели |
| | Kiro | $0 | Без ограничений | Claude бесплатно |

**💡 Профи-совет:** Начните с комбо Gemini CLI (180K бесплатно/мес) + iFlow (без ограничений бесплатно) = $0 затрат!

---

### 📊 Понимание затрат и оплаты в 9Router

**Реальность оплаты 9Router:**

✅ **Софт 9Router = БЕСПЛАТНО навсегда** (открытый код, никогда не взимает плату)  
✅ **«Затраты» на панели = Только для отображения/отслеживания** (не реальный счёт)  
✅ **Вы платите напрямую провайдерам** (подписка или плата за API)  
✅ **БЕСПЛАТНЫЕ провайдеры остаются БЕСПЛАТНЫМИ** (iFlow, Kiro, Qwen = $0 без ограничений)  
❌ **9Router никогда не выставляет счёт** и не списывает с вашей карты

**Как работает отображение затрат:**

Панель показывает **оценочные затраты**, как если бы вы напрямую использовали платный API. Это **не оплата** — это инструмент сравнения, показывающий вашу экономию.

**Пример сценария:**
```
Показано на панели:
• Всего запросов: 1,662
• Всего токенов: 47M
• Отображаемые затраты: $290

Реальная проверка:
• Провайдер: iFlow (БЕСПЛАТНО без ограничений)
• Фактическая оплата: $0.00
• Значение $290: Сумма, которую вы СЭКОНОМИЛИ, используя бесплатные модели!
```

**Правила оплаты:**
- **Провайдеры подписки** (Claude Code, Codex): Платите им напрямую через их сайт
- **Дешёвые провайдеры** (GLM, MiniMax): Платите им напрямую, 9Router только маршрутизирует
- **БЕСПЛАТНЫЕ провайдеры** (iFlow, Kiro, Qwen): Действительно бесплатны навсегда, без скрытых платежей
- **9Router**: Никогда ничего не взимает, никогда

---

## 🎯 Сценарии использования

### Сценарий 1: «У меня подписка Claude Pro»

**Проблема:** Квота сгорает неиспользованной, rate limit при интенсивной работе

**Решение:**
```
Combo: "maximize-claude"
  1. cc/claude-opus-4-6        (полное использование подписки)
  2. glm/glm-4.7               (дешёвый бэкап при исчерпании квоты)
  3. if/kimi-k2-thinking       (бесплатное аварийное резервирование)

Месячная стоимость: $20 (подписка) + ~$5 (бэкап) = $25 итого
против $20 + упирание в лимит = разочарование
```

### Сценарий 2: «Хочу нулевые затраты»

**Проблема:** Не могу позволить подписку, нужен надёжный AI-кодинг

**Решение:**
```
Combo: "free-forever"
  1. gc/gemini-3-flash         (180K бесплатно/мес)
  2. if/kimi-k2-thinking       (без ограничений бесплатно)
  3. qw/qwen3-coder-plus       (без ограничений бесплатно)

Месячная стоимость: $0
Качество: Production-ready модели
```

### Сценарий 3: «Нужно кодить 24/7, без перерывов»

**Проблема:** Дедлайны, нельзя допустить простоя

**Решение:**
```
Combo: "always-on"
  1. cc/claude-opus-4-6        (лучшее качество)
  2. cx/gpt-5.2-codex          (вторая подписка)
  3. glm/glm-4.7               (дёшево, ежедневный сброс)
  4. minimax/MiniMax-M2.1      (самый дешёвый, сброс 5ч)
  5. if/kimi-k2-thinking       (бесплатно без ограничений)

Результат: 5 слоёв резервирования = нулевой простой
Месячная стоимость: $20-200 (подписки) + $10-20 (бэкап)
```

### Сценарий 4: «Хочу БЕСПЛАТНЫЙ AI в OpenClaw»

**Проблема:** Нужен AI-ассистент в мессенджерах (WhatsApp, Telegram, Slack...), полностью бесплатно

**Решение:**
```
Combo: "openclaw-free"
  1. if/glm-4.7                (без ограничений бесплатно)
  2. if/minimax-m2.1           (без ограничений бесплатно)
  3. if/kimi-k2-thinking       (без ограничений бесплатно)

Месячная стоимость: $0
Доступ через: WhatsApp, Telegram, Slack, Discord, iMessage, Signal...
```

---

## ❓ Часто задаваемые вопросы

<details>
<summary><b>📊 Почему моя панель показывает высокие затраты?</b></summary>

Панель отслеживает ваше использование токенов и показывает **оценочные затраты**, как если бы вы напрямую использовали платный API. Это **не реальная оплата** — это справка, показывающая, сколько вы экономите, используя бесплатные модели или существующие подписки через 9Router.

**Пример:**
- **Панель показывает:** «Общие затраты $290»
- **Реальность:** Вы используете iFlow (БЕСПЛАТНО без ограничений)
- **Ваши фактические затраты:** **$0.00**
- **Значение $290:** Сумма, которую вы **экономите**, используя бесплатные модели вместо платного API!

Отображение затрат — это «трекер экономии», помогающий понять паттерны использования и возможности оптимизации.

</details>

<details>
<summary><b>💳 Взимает ли с меня плату 9Router?</b></summary>

**Нет.** 9Router — это бесплатное ПО с открытым кодом, работающее на вашем собственном компьютере. Оно никогда ничего с вас не взимает.

**Вы платите только:**
- ✅ **Провайдерам подписки** (Claude Code $20/мес, Codex $20-200/мес) → Платите им напрямую на их сайте
- ✅ **Дешёвым провайдерам** (GLM, MiniMax) → Платите им напрямую, 9Router только маршрутизирует ваши запросы
- ❌ **Самому 9Router** → **Никогда ничего не взимает, никогда**

9Router — это локальный прокси/роутер. У него нет вашей кредитной карты, он не может выставлять счета и не имеет платёжной системы. Это полностью бесплатное ПО.

</details>

<details>
<summary><b>🆓 Действительно ли БЕСПЛАТНЫЕ провайдеры безлимитны?</b></summary>

**Да!** Провайдеры, отмеченные как БЕСПЛАТНЫЕ (iFlow, Kiro, Qwen), действительно безлимитны и **без скрытых платежей**. 

Это бесплатные сервисы, предоставляемые соответствующими компаниями:
- **iFlow**: Бесплатный безлимитный доступ к 8+ моделям через OAuth
- **Kiro**: Бесплатные безлимитные модели Claude через AWS Builder ID  
- **Qwen**: Бесплатный безлимитный доступ к моделям Qwen через аутентификацию устройства

9Router только маршрутизирует ваши запросы к ним — никаких «ловушек» или будущих платежей. Это действительно бесплатные сервисы, а 9Router облегчает их использование с поддержкой резервирования.

**Примечание:** Некоторые провайдеры подписки (Antigravity, GitHub Copilot) могут иметь бесплатные пробные периоды, которые позже становятся платными, но об этом чётко уведомляют сами провайдеры, а не 9Router.

</details>

<details>
<summary><b>💰 Как минимизировать мои реальные AI-затраты?</b></summary>

**Стратегия «Бесплатное в приоритете»:**

1. **Начните со 100% бесплатного комбо:**
   ```
   1. gc/gemini-3-flash (180K/мес бесплатно от Google)
   2. if/kimi-k2-thinking (без ограничений бесплатно от iFlow)
   3. qw/qwen3-coder-plus (без ограничений бесплатно от Qwen)
   ```
   **Стоимость: $0/мес**

2. **Добавьте дешёвый бэкап** только при необходимости:
   ```
   4. glm/glm-4.7 ($0.6/1M токенов)
   ```
   **Доп. стоимость:** Платите только за то, что фактически используете

3. **Используйте провайдеров подписки в последнюю очередь:**
   - Только если они у вас уже есть
   - 9Router помогает максимизировать их ценность через отслеживание квоты

**Результат:** Большинство пользователей могут работать за $0/мес, используя только бесплатные уровни!

</details>

<details>
<summary><b>📈 Что если моё использование внезапно вырастет?</b></summary>

Умный механизм резервирования 9Router предотвращает неожиданные расходы:

**Сценарий:** Вы в спринте кодинга и превышаете квоты

**Без 9Router:**
- ❌ Упёрлись в rate limit → Работа остановилась → Разочарование
- ❌ Или: Случайно накопили огромный счёт за API

**С 9Router:**
- ✅ Подписка упёрлась в лимит → Авторезервирование на дешёвый уровень
- ✅ Дешёвый уровень становится дорогим → Авторезервирование на бесплатный уровень
- ✅ Никогда не прекращаете кодить → Предсказуемая стоимость

**Вы контролируете:** Установите лимиты расходов на каждого провайдера в панели, и 9Router будет их соблюдать.

</details>

---

## 📖 Руководство по настройке

<details>
<summary><b>🔐 Провайдеры подписки (Максимум ценности)</b></summary>

### Claude Code (Pro/Max)

```bash
Панель управления → Providers → Подключить Claude Code
→ Вход через OAuth → Авто-обновление токена
→ Отслеживание квоты 5 часов + еженедельно

Модели:
  cc/claude-opus-4-6
  cc/claude-sonnet-4-5-20250929
  cc/claude-haiku-4-5-20251001
```

**Профи-совет:** Используйте Opus для сложных задач, Sonnet для скорости. 9Router отслеживает квоту для каждой модели!

### OpenAI Codex (Plus/Pro)

```bash
Панель управления → Providers → Подключить Codex
→ Вход через OAuth (порт 1455)
→ Сброс 5 часов + еженедельно

Модели:
  cx/gpt-5.2-codex
  cx/gpt-5.1-codex-max
```

### Gemini CLI (БЕСПЛАТНО 180K/мес!)

```bash
Панель управления → Providers → Подключить Gemini CLI
→ Google OAuth
→ 180K запросов/мес + 1K/день

Модели:
  gc/gemini-3-flash-preview
  gc/gemini-2.5-pro
```

**Лучшая ценность:** Огромный бесплатный уровень! Используйте его перед платными уровнями.

### GitHub Copilot

```bash
Панель управления → Providers → Подключить GitHub
→ OAuth через GitHub
→ Ежемесячный сброс (1-го числа месяца)

Модели:
  gh/gpt-5
  gh/claude-4.5-sonnet
  gh/gemini-3-pro
```

</details>

<details>
<summary><b>💰 Дешёвые провайдеры (Бэкап)</b></summary>

### GLM-4.7 (Ежедневный сброс, $0.6/1M)

1. Регистрация: [Zhipu AI](https://open.bigmodel.cn/)
2. Получите API key из Coding Plan
3. Панель управления → Добавить API Key:
   - Провайдер: `glm`
   - API Key: `your-key`

**Использование:** `glm/glm-4.7`

**Профи-совет:** Coding Plan даёт втрое больше квоты за 1/7 стоимости! Сброс ежедневно в 10:00.

### MiniMax M2.1 (Сброс 5ч, $0.20/1M)

1. Регистрация: [MiniMax](https://www.minimax.io/)
2. Получите API key
3. Панель управления → Добавить API Key

**Использование:** `minimax/MiniMax-M2.1`

**Профи-совет:** Самый дешёвый вариант для длинного контекста (1M)!

### Kimi K2 ($9/мес фиксированно)

1. Регистрация: [Moonshot AI](https://platform.moonshot.ai/)
2. Получите API key
3. Панель управления → Добавить API Key

**Использование:** `kimi/kimi-latest`

**Профи-совет:** Фиксированные $9/мес за 10M токенов = реальная стоимость $0.90/1M!

</details>

<details>
<summary><b>🆓 БЕСПЛАТНЫЕ провайдеры (Аварийное резервирование)</b></summary>

### iFlow (8 БЕСПЛАТНЫХ моделей)

```bash
Панель управления → Подключить iFlow
→ Вход через OAuth iFlow
→ Безлимитное использование

Модели:
  if/kimi-k2-thinking
  if/qwen3-coder-plus
  if/glm-4.7
  if/minimax-m2
  if/deepseek-r1
```

### Qwen (3 БЕСПЛАТНЫЕ модели)

```bash
Панель управления → Подключить Qwen
→ Авторизация по коду устройства
→ Безлимитное использование

Модели:
  qw/qwen3-coder-plus
  qw/qwen3-coder-flash
```

### Kiro (БЕСПЛАТНЫЙ Claude)

```bash
Панель управления → Подключить Kiro
→ AWS Builder ID или Google/GitHub
→ Безлимитное использование

Модели:
  kr/claude-sonnet-4.5
  kr/claude-haiku-4.5
```

</details>

<details>
<summary><b>🎨 Создание комбо</b></summary>

### Пример 1: Максимум из подписки → Дешёвый бэкап

```
Панель управления → Combos → Создать новое

Имя: premium-coding
Модели:
  1. cc/claude-opus-4-6 (Основная подписка)
  2. glm/glm-4.7 (Дешёвый бэкап, $0.6/1M)
  3. minimax/MiniMax-M2.1 (Самое дешёвое резервирование, $0.20/1M)

Использование в CLI: premium-coding

Пример месячной стоимости (100M токенов):
  80M через Claude (подписка): $0 дополнительно
  15M через GLM: $9
  5M через MiniMax: $1
  Итого: $10 + ваша подписка
```

### Пример 2: Только бесплатно (Нулевая стоимость)

```
Имя: free-combo
Модели:
  1. gc/gemini-3-flash-preview (180K бесплатно/мес)
  2. if/kimi-k2-thinking (без ограничений)
  3. qw/qwen3-coder-plus (без ограничений)

Стоимость: $0 навсегда!
```

</details>

<details>
<summary><b>🔧 Интеграция CLI</b></summary>

### Cursor IDE

```
Settings → Models → Advanced:
  OpenAI API Base URL: http://localhost:20128/v1
  OpenAI API Key: [из панели управления 9router]
  Model: cc/claude-opus-4-6
```

Или используйте комбо: `premium-coding`

### Claude Code

Отредактируйте `~/.claude/config.json`:

```json
{
  "anthropic_api_base": "http://localhost:20128/v1",
  "anthropic_api_key": "your-9router-api-key"
}
```

### Codex CLI

```bash
export OPENAI_BASE_URL="http://localhost:20128"
export OPENAI_API_KEY="your-9router-api-key"

codex "ваш промпт"
```

### OpenClaw

**Вариант 1 — Панель управления (рекомендуется):**

```
Панель управления → CLI Tools → OpenClaw → Выбрать модель → Применить
```

**Вариант 2 — Вручную:** Отредактируйте `~/.openclaw/openclaw.json`:

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "9router/if/glm-4.7"
      }
    }
  },
  "models": {
    "providers": {
      "9router": {
        "baseUrl": "http://127.0.0.1:20128/v1",
        "apiKey": "sk_9router",
        "api": "openai-completions",
        "models": [
          {
            "id": "if/glm-4.7",
            "name": "glm-4.7"
          }
        ]
      }
    }
  }
}
```

> **Примечание:** OpenClaw работает только с локальным 9Router. Используйте `127.0.0.1` вместо `localhost`, чтобы избежать проблем с разрешением имён.

### Cline / Continue / RooCode

```
Provider: OpenAI Compatible
Base URL: http://localhost:20128/v1
API Key: [из панели управления]
Model: cc/claude-opus-4-6
```

</details>

<details>
<summary><b>🚀 Развёртывание</b></summary>

### Развёртывание на VPS

```bash
# Clone and install
git clone https://github.com/decolua/9router.git
cd 9router
npm install
npm run build

# Configure
export JWT="your-secure-secret-change-this"
export INITIAL_PASSWORD="your-password"
export DATA_DIR="/var/lib/9router"
export PORT="20128"
export HOSTNAME="0.0.0.0"
export NODE_ENV="production"
export NEXT_PUBLIC_BASE_URL="http://localhost:20128"
export NEXT_PUBLIC_CLOUD_URL="https://9router.com"
export API_KEY_SECRET="endpoint-proxy-api-key-secret"
export MACHINE_ID_SALT="endpoint-proxy-salt"

# Start
npm run start

# Or use PM2
npm install -g pm2
pm2 start --name 9router -- start
pm2 save
pm2 startup
```

### Docker

```bash
# Build image (from repository root)
docker build -t 9router .

# Run container (command used in current setup)
docker run -d \
  --name 9router \
  -p 20128:20128 \
  --env-file /root/dev/9router/.env \
  -v 9router-data:/app/data \
  -v 9router-usage:/root/.9router \
  9router
```

Портативная команда (если вы уже в корне репозитория):

```bash
docker run -d \
  --name 9router \
  -p 20128:20128 \
  --env-file ./.env \
  -v 9router-data:/app/data \
  -v 9router-usage:/root/.9router \
  9router
```

Значения по умолчанию контейнера:
- `PORT=20128`
- `HOSTNAME=0.0.0.0`

Полезные команды:

```bash
docker logs -f 9router
docker restart 9router
docker stop 9router && docker rm 9router
```

### Переменные окружения

| Переменная | По умолчанию | Описание |
|----------|---------|-------------|
| `JWT_SECRET` | Автогенерация (`~/.9router/jwt-secret`) | Секрет подписи JWT для cookie аутентификации панели (задайте для общего доступа между инстансами) |
| `INITIAL_PASSWORD` | `123456` | Пароль первого входа при отсутствии сохранённого хеша |
| `DATA_DIR` | `~/.9router` | Расположение основной БД приложения (`db.json`) |
| `PORT` | framework default | Порт сервиса (`20128` в примерах) |
| `HOSTNAME` | framework default | Bind host (Docker по умолчанию `0.0.0.0`) |
| `NODE_ENV` | runtime default | Установите `production` для развёртывания |
| `BASE_URL` | `http://localhost:20128` | Внутренний серверный базовый URL для задач облачной синхронизации |
| `CLOUD_URL` | `https://9router.com` | Серверный базовый URL эндпоинта облачной синхронизации |
| `NEXT_PUBLIC_BASE_URL` | `http://localhost:3000` | Обратно совместимый/публичный базовый URL (приоритет `BASE_URL` для серверного рантайма) |
| `NEXT_PUBLIC_CLOUD_URL` | `https://9router.com` | Обратно совместимый/публичный облачный URL (приоритет `CLOUD_URL` для серверного рантайма) |
| `API_KEY_SECRET` | `endpoint-proxy-api-key-secret` | HMAC-секрет для генерируемых API-ключей |
| `MACHINE_ID_SALT` | `endpoint-proxy-salt` | Соль для стабильного хеширования ID машины |
| `ENABLE_REQUEST_LOGS` | `false` | Включить лог запросов/ответов в `logs/` |
| `AUTH_COOKIE_SECURE` | `false` | Принудительный `Secure` cookie аутентификации (задайте `true` за HTTPS reverse proxy) |
| `REQUIRE_API_KEY` | `false` | Требовать Bearer API key на маршрутах `/v1/*` (рекомендуется для развёртываний с выходом в интернет) |
| `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY` | empty | Опциональный исходящий прокси для вызовов к провайдерам |

Примечания:
- Прокси-переменные в нижнем регистре также поддерживаются: `http_proxy`, `https_proxy`, `all_proxy`, `no_proxy`.
- `.env` не запекается в Docker-образ (`.dockerignore`); подавайте runtime-конфигурацию через `--env-file` или `-e`.
- В Windows для разрешения путей локального хранилища может использоваться `APPDATA`.
- `INSTANCE_NAME` встречается в старых docs/env-шаблонах, но сейчас в рантайме не используется.

### Runtime-файлы и хранилище

- Основное состояние приложения: `${DATA_DIR}/db.json` (провайдеры, комбо, alias, ключи, настройки), управляется `src/lib/localDb.js`.
- История использования и логи: `~/.9router/usage.json` и `~/.9router/log.txt`, управляется `src/lib/usageDb.js`.
- Опциональные логи запросов/транслятора: `<repo>/logs/...` при `ENABLE_REQUEST_LOGS=true`.
- Хранилище использования следует логике пути `~/.9router` и независимо от `DATA_DIR`.

</details>

---

## 📊 Доступные модели

<details>
<summary><b>Показать все доступные модели</b></summary>

**Claude Code (`cc/`)** - Pro/Max:
- `cc/claude-opus-4-6`
- `cc/claude-sonnet-4-5-20250929`
- `cc/claude-haiku-4-5-20251001`

**Codex (`cx/`)** - Plus/Pro:
- `cx/gpt-5.2-codex`
- `cx/gpt-5.1-codex-max`

**Gemini CLI (`gc/`)** - БЕСПЛАТНО:
- `gc/gemini-3-flash-preview`
- `gc/gemini-2.5-pro`

**GitHub Copilot (`gh/`)**:
- `gh/gpt-5`
- `gh/claude-4.5-sonnet`

**GLM (`glm/`)** - $0.6/1M:
- `glm/glm-4.7`

**MiniMax (`minimax/`)** - $0.2/1M:
- `minimax/MiniMax-M2.1`

**iFlow (`if/`)** - БЕСПЛАТНО:
- `if/kimi-k2-thinking`
- `if/qwen3-coder-plus`
- `if/deepseek-r1`

**Qwen (`qw/`)** - БЕСПЛАТНО:
- `qw/qwen3-coder-plus`
- `qw/qwen3-coder-flash`

**Kiro (`kr/`)** - БЕСПЛАТНО:
- `kr/claude-sonnet-4.5`
- `kr/claude-haiku-4.5`

</details>

---

## 🐛 Устранение неполадок

**"Language model did not provide messages"**
- Исчерпана квота провайдера → Проверьте трекер квоты на панели
- Решение: Используйте резервирование комбо или переключитесь на более дешёвый уровень

**Ограничение скорости (Rate limiting)**
- Исчерпана квота подписки → Резервирование на GLM/MiniMax
- Добавьте комбо: `cc/claude-opus-4-6 → glm/glm-4.7 → if/kimi-k2-thinking`

**OAuth-токен истёк**
- Автообновление 9Router
- Если проблема сохраняется: Панель управления → Провайдеры → Переподключить

**Высокие затраты**
- Проверьте статистику использования в панели
- Переключите основную модель на GLM/MiniMax
- Используйте бесплатные уровни (Gemini CLI, iFlow) для некритичных задач

**Панель открывается на неверном порту**
- Установите `PORT=20128` и `NEXT_PUBLIC_BASE_URL=http://localhost:20128`

**Ошибки облачной синхронизации**
- Убедитесь, что `BASE_URL` указывает на ваш работающий инстанс (например, `http://localhost:20128`)
- Убедитесь, что `CLOUD_URL` указывает на ожидаемый облачный эндпоинт (например, `https://9router.com`)
- По возможности держите значения `NEXT_PUBLIC_*` согласованными с серверными значениями.

**Облачный эндпоинт `stream=false` возвращает 500 (`Unexpected token 'd'...`)**
- Симптом обычно появляется на публичном облачном эндпоинте (`https://9router.com/v1`) для непотоковых (non-streaming) вызовов.
- Корневая причина: upstream возвращает SSE-payload (`data: ...`), тогда как клиент ожидает JSON.
- Обходное решение: используйте `stream=true` для прямых вызовов в облако.
- Локальный рантайм 9Router включает резервирование SSE→JSON для непотоковых вызовов, когда upstream возвращает `text/event-stream`.

**Облако сообщает о подключении, но запрос всё равно падает с `Invalid API key`**
- Создайте новый ключ в локальной панели (`/api/keys`) и запустите облачную синхронизацию (`Enable Cloud`, затем `Sync Now`).
- Старые/несинхронизированные ключи могут возвращать `401` в облаке, даже если локальный эндпоинт работает.

**Первый вход не работает**
- Проверьте `INITIAL_PASSWORD` в `.env`
- Если не задан, резервный пароль — `123456`

**Нет логов запросов в `logs/`**
- Установите `ENABLE_REQUEST_LOGS=true`

---

## 🛠️ Tech Stack

- **Runtime**: Node.js 20+
- **Framework**: Next.js 16
- **UI**: React 19 + Tailwind 4
- **Database**: LowDB (на основе JSON-файлов)
- **Streaming**: Server-Sent Events (SSE)
- **Auth**: OAuth 2.0 (PKCE) + JWT + API Keys

---

## 📝 Справочник по API

### Chat Completions

```bash
POST http://localhost:20128/v1/chat/completions
Authorization: Bearer your-api-key
Content-Type: application/json

{
  "model": "cc/claude-opus-4-6",
  "messages": [
    {"role": "user", "content": "Напиши функцию для..."}
  ],
  "stream": true
}
```

### Список моделей

```bash
GET http://localhost:20128/v1/models
Authorization: Bearer your-api-key

→ Возвращает все модели + комбо в формате OpenAI
```

### Совместимые эндпоинты

- `POST /v1/chat/completions`
- `POST /v1/messages`
- `POST /v1/responses`
- `GET /v1/models`
- `POST /v1/messages/count_tokens`
- `GET /v1beta/models`
- `POST /v1beta/models/{...path}` (Gemini-style `generateContent`)
- `POST /v1/api/chat` (путь конвертации в стиле Ollama)

### Скрипты облачной аутентификации

Добавлены тестовые скрипты в `tester/security/`:

- `tester/security/test-docker-hardening.sh`
  - Собирает Docker-образ и проверяет hardening-проверки (`/api/cloud/auth` auth guard, `REQUIRE_API_KEY`, безопасное поведение cookie аутентификации).
- `tester/security/test-cloud-openai-compatible.sh`
  - Отправляет OpenAI-совместимый запрос напрямую на облачный эндпоинт (`https://9router.com/v1/chat/completions`) с указанной моделью/ключом.
- `tester/security/test-cloud-sync-and-call.sh`
  - End-to-end процесс: создание локального ключа → включение/синхронизация облака → вызов облачного эндпоинта с повтором.
  - Включает резервную проверку с `stream=true`, чтобы отличить ошибки аутентификации от проблем разбора потока.

Заметки по безопасности для облачных тестовых скриптов:

- Никогда не хардкодьте реальные API-ключи в скриптах/коммитах.
- Передавайте ключи только через переменные окружения:
  - `API_KEY`, `CLOUD_API_KEY` или `OPENAI_API_KEY` (поддерживается `test-cloud-openai-compatible.sh`)
- Пример:

```bash
OPENAI_API_KEY="your-cloud-key" bash tester/security/test-cloud-openai-compatible.sh
```

Ожидаемое поведение по результатам недавней проверки:

- Локально (`http://127.0.0.1:20128/v1/chat/completions`): работает с `stream=false` и `stream=true`.
- Docker-рантайм (тот же API-путь, экспонируемый контейнером): hardening-проверки проходят, cloud auth guard работает, строгий режим API-ключа работает при включении.
- Публичный облачный эндпоинт (`https://9router.com/v1/chat/completions`):
  - `stream=true`: ожидается успех (возвращает SSE-чанки).
  - `stream=false`: может падать с `500` + ошибкой разбора (`Unexpected token 'd'`), когда upstream возвращает SSE-контент для непотокового клиентского пути.

### API управления и панели

- Аутентификация/настройки: `/api/auth/login`, `/api/auth/logout`, `/api/settings`, `/api/settings/require-login`
- Управление провайдерами: `/api/providers`, `/api/providers/[id]`, `/api/providers/[id]/test`, `/api/providers/[id]/models`, `/api/providers/validate`, `/api/provider-n*`
- OAuth-потоки: `/api/oauth/[provider]/[action]` (+ специфичные для провайдеров импорты, такие как Cursor/Kiro)
- Конфигурация маршрутизации: `/api/models/alias`, `/api/combos*`, `/api/keys*`, `/api/pricing`
- Использование/логи: `/api/usage/history`, `/api/usage/logs`, `/api/usage/request-logs`, `/api/usage/[connectionId]`
- Облачная синхронизация: `/api/sync/cloud`, `/api/sync/initialize`, `/api/cloud/*`
- Помощники CLI: `/api/cli-tools/claude-settings`, `/api/cli-tools/codex-settings`, `/api/cli-tools/droid-settings`, `/api/cli-tools/openclaw-settings`

### Поведение аутентификации

- Маршруты панели (`/dashboard/*`) используют защиту cookie `auth_token`.
- Вход использует сохранённый хеш пароля при наличии; иначе откатывается к `INITIAL_PASSWORD`.
- `requireLogin` можно переключить через `/api/settings/require-login`.

### Обработка запросов (высокоуровнево)

1. Клиент отправляет запрос на `/v1/*`.
2. Обработчик маршрута вызывает `handleChat` (`src/sse/handlers/chat.js`).
3. Модель разрешается (прямой провайдер/модель или разрешение alias/combo).
4. Учётные данные выбираются из локальной БД с фильтром доступности аккаунта.
5. `handleChatCore` (`open-sse/handlers/chatCore.js`) определяет формат и транслирует запрос.
6. Исполнитель провайдера отправляет upstream-запрос.
7. Поток при необходимости транслируется обратно в клиентский формат.
8. Использование/логи записываются (`src/lib/usageDb.js`).
9. Резервирование применяется при ошибках провайдера/аккаунта/модели по правилам комбо.

Полный справочник по архитектуре: [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md)

---

## 📧 Поддержка

- **Сайт**: [9router.com](https://9router.com)
- **GitHub**: [github.com/decolua/9router](https://github.com/decolua/9router)
- **Issues**: [github.com/decolua/9router/issues](https://github.com/decolua/9router/issues)

---

## 👥 Контрибьюторы

Спасибо всем, кто помогает делать 9Router лучше!

[![Contributors](https://contrib.rocks/image?repo=decolua/9router&max=100&columns=20&anon=1)](https://github.com/decolua/9router/graphs/contributors)

---

## 📊 Star Chart

[![Star Chart](https://starchart.cc/decolua/9router.svg?variant=adaptive)](https://starchart.cc/decolua/9router)

### Как внести вклад

1. Сделайте форк репозитория
2. Создайте свою feature-ветку (`git checkout -b feature/amazing-feature`)
3. Закоммитьте изменения (`git commit -m 'Add amazing feature'`)
4. Запушьте в ветку (`git push origin feature/amazing-feature`)
5. Откройте Pull Request

См. [Pull Requests](https://github.com/decolua/9router/pulls) для подробных инструкций.

---

## 🔀 Форки

**[OmniRoute](https://github.com/diegosouzapw/OmniRoute)** — Полнофункциональный TypeScript-форк 9Router. Добавляет 36+ провайдеров, авторезервирование на 4 уровнях, мультимодальный API (изображения, embedding, аудио, TTS), circuit breaker, семантическое кеширование, оценку LLM и доработанную панель. 368+ юнит-тестов. Доступен через npm.

---

## 🙏 Благодарности

Особая благодарность **CLIProxyAPI** — оригинальной Go-реализации, вдохновившей этот JavaScript-порт.

---

## 📄 Лицензия

Лицензия MIT — см. [LICENSE](../LICENSE) для деталей.

---

<div align="center">
  <sub>Создано с ❤️ для разработчиков, которые кодят 24/7</sub>
</div>
