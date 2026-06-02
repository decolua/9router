# 🔑 9router-secrets — Универсальное хранилище ключей

Эта папка содержит все секреты для 9router: API-ключи, провайдеры, конфиги.

## 📁 Где хранить?

**Где угодно.** Главное — чтобы было доступно с твоего компьютера:

| Место | Команда для монтирования |
|-------|--------------------------|
| **Яндекс.Диск** | `~/Yandex.Disk/9router-secrets` (авто) |
| **Google Drive** | `~/Google Drive/9router-secrets` (авто) |
| **Dropbox** | `~/Dropbox/9router-secrets` (авто) |
| **Локально** | `~/9router-secrets` (авто) |
| **USB-флешка** | `/media/usb/9router-secrets` |
| **Сетевая папка (NAS)** | `/mnt/nas/9router-secrets` |
| **rclone / S3** | `~/cloud/9router-secrets` |
| **Любой кастомный путь** | Укажи при установке |

## 📋 Структура папки

```
9router-secrets/
├── .env                  # 🔑 Главный файл с API-ключами
└── providers/            # 🔌 JSON-файлы провайдеров
    ├── openai.json
    ├── anthropic.json
    ├── opencode.json
    ├── ollama-local.json
    └── ...
```

## 📝 Файл .env — API-ключи

Пример содержимого `.env`:

```env
# ─── Обязательные ───
JWT_SECRET=сюда_рандомную_строку_32_символа
INITIAL_PASSWORD=9router

# ─── API-ключи AI (нужно получить на сайтах) ───
OPENAI_API_KEY=sk-your-openai-key-here
ANTHROPIC_API_KEY=sk-ant-your-claude-key-here
OPENCODE_API_KEY=your-opencode-key-here
GROQ_API_KEY=gsk_your-groq-key-here
MISTRAL_API_KEY=your-mistral-key-here
COHERE_API_KEY=your-cohere-key-here
DEEPSEEK_API_KEY=your-deepseek-key-here
GEMINI_API_KEY=your-gemini-key-here

# ─── Дополнительно ───
# Для локального Ollama ключ не нужен
# OLLAMA_HOST=http://host.docker.internal:11434
```

## 🔌 Файлы провайдеров (providers/*.json)

Каждый JSON-файл — это один провайдер. Пример:

<details>
<summary>openai.json</summary>

```json
{
  "name": "OpenAI",
  "apiKey": "sk-...",
  "baseUrl": "https://api.openai.com/v1",
  "models": [
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4-turbo",
    "gpt-3.5-turbo"
  ],
  "type": "openai"
}
```
</details>

<details>
<summary>opencode.json</summary>

```json
{
  "name": "OpenCode Free",
  "apiKey": "your-opencode-key",
  "baseUrl": "https://api.opencode.com/v1",
  "models": [
    "opencode-mixtral-8x22b",
    "opencode-llama-3-70b"
  ],
  "type": "openai"
}
```
</details>

<details>
<summary>ollama-local.json</summary>

```json
{
  "name": "Ollama Local",
  "baseUrl": "http://host.docker.internal:11434",
  "models": [
    "qwen2.5-coder:7b",
    "llama3.1:8b",
    "mistral:7b"
  ],
  "type": "openai"
}
```
</details>

## 🚀 Быстрый старт на новом компе

1. Смонтируй облачное хранилище (Яндекс.Диск / Google Drive и т.д.)
2. Запусти установщик:

```bash
# Linux/Mac
bash install-russian.sh

# Windows
setup.bat

# Любая ОС
python setup.py
```

3. Установщик сам найдёт папку `9router-secrets` или спросит путь
4. Всё! 9router готов к работе

## 🔐 Безопасность

- **Никогда не коммить** папку `9router-secrets` в Git!
- `.gitignore` уже содержит `9router-secrets/`
- Храни эту папку в зашифрованном виде, если используешь съёмные носители
- Для максимальной безопасности используй `rclone crypt` или VeraCrypt

## 🔄 Миграция

При смене компьютера:
1. Скопируй папку `9router-secrets` на новый компьютер
2. Запусти `install-russian.sh` / `setup.bat` / `setup.py`
3. Укажи путь к скопированной папке
4. Готово! Все ключи и провайдеры восстановлены

## 💡 Совет

Поставь переменную окружения `SECRETS_STORAGE` в ~/.bashrc или системные переменные Windows:

```bash
# Linux/Mac — в ~/.bashrc
export SECRETS_STORAGE="$HOME/Yandex.Disk/9router-secrets"

# Windows — системная переменная
SECRETS_STORAGE=C:\Users\YourName\Yandex.Disk\9router-secrets
```

Тогда установщик найдёт ключи без лишних вопросов.
</write_to_file>
<task_progress>
- [x] Создать setup.bat (Windows)
- [x] Создать setup.sh (Linux/Mac)
- [x] Создать setup.py (универсальный)
- [x] Обновить install-russian.sh — универсальный поиск хранилища ключей
- [x] Обновить setup.bat — универсальный поиск хранилища
- [x] Обновить setup.sh — универсальный поиск хранилища
- [x] Обновить setup.py — универсальный поиск хранилища
- [x] Создать SECRETS_README.md — инструкция по организации ключей
- [ ] Закоммитить и запушить в GitHub
</task_progress>
</write_to_file>