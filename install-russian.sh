#!/bin/bash
# =============================================
#  9router-russian — One-command install
#  curl -fsSL https://raw.githubusercontent.com/mdn77/9router-russian/master/install-russian.sh | bash
#  
#  Принцип работы:
#  1. Ищет папку с ключами (9router-secrets) — можно указать путь
#  2. Клонирует/обновляет репозиторий
#  3. Копирует .env и провайдеров из папки с ключами
#  4. Запускает Docker
#  5. Импортирует провайдеров через API
# =============================================

set -e

REPO_URL="https://github.com/mdn77/9router-russian.git"
INSTALL_DIR="${HOME}/9router-russian"
PORT="20128"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;91m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}"
echo "╔══════════════════════════════════════════╗"
echo "║    9router-russian — Russian Edition     ║"
echo "║    🚀 Одно-кликовое развёртывание        ║"
echo "╚══════════════════════════════════════════╝"
echo -e "${NC}"

# ═════════════════════════════════════════════
# ШАГ 1: Поиск хранилища с ключами
# ═════════════════════════════════════════════
echo -e "\n[1/6] 🔑 Поиск хранилища с ключами..."
echo -e "  ${CYAN}Укажи путь к папке '9router-secrets', где лежат:${NC}"
echo -e "    • ${BOLD}.env${NC} — с API-ключами (OpenAI, Claude, OpenCode и др.)"
echo -e "    • ${BOLD}providers/*.json${NC} — файлы провайдеров"
echo -e ""
echo -e "  ${CYAN}Где хранить: Яндекс.Диск, Google Drive, Dropbox,${NC}"
echo -e "  ${CYAN}USB-флешка, сетевая папка, Nextcloud — что угодно.${NC}"
echo -e "  ${CYAN}Просто скопируй папку на новый комп и укажи путь.${NC}"
echo ""

# Сначала проверяем переменную окружения
SECRETS_DIR=""
if [ -n "$SECRETS_STORAGE" ] && [ -d "$SECRETS_STORAGE" ]; then
    SECRETS_DIR="$SECRETS_STORAGE"
    echo -e "  ${GREEN}[✅] Используется SECRETS_STORAGE: $SECRETS_DIR${NC}"
fi

# Если не задана, ищем в облачных хранилищах
if [ -z "$SECRETS_DIR" ]; then
    for base in \
        "$HOME/Yandex.Disk" \
        "$HOME/Downloads/Yandex.Disk" \
        "$HOME/Google Drive" \
        "$HOME/My Drive" \
        "$HOME/Dropbox" \
        "$HOME/Nextcloud" \
        "$HOME"; do
        
        candidate="$base/9router-secrets"
        if [ -d "$candidate" ] && [ -f "$candidate/.env" ]; then
            SECRETS_DIR="$candidate"
            echo -e "  ${GREEN}[✅] Найдена папка с ключами: $SECRETS_DIR${NC}"
            break
        fi
    done
fi

# Если всё ещё не нашли — спрашиваем пользователя
if [ -z "$SECRETS_DIR" ]; then
    echo -e "  ${YELLOW}[⚠️] Папка '9router-secrets' не найдена автоматически.${NC}"
    echo -e "  ${CYAN}Укажи путь к ней вручную.${NC}"
    echo -e "  ${CYAN}Это может быть: Яндекс.Диск / Google Drive / USB-флешка / сетевая папка / rclone-монтирование ...${NC}"
    echo ""
    read -p "  Путь к папке 9router-secrets (Enter чтобы пропустить): " CUSTOM_PATH
    
    if [ -n "$CUSTOM_PATH" ]; then
        if [ -d "$CUSTOM_PATH" ]; then
            SECRETS_DIR="$CUSTOM_PATH"
            echo -e "  ${GREEN}[✅] Используется: $SECRETS_DIR${NC}"
        else
            echo -e "  ${RED}[❌] Папка не найдена: $CUSTOM_PATH${NC}"
            echo -e "  ${YELLOW}Пропускаем импорт ключей.${NC}"
        fi
    else
        echo -e "  ${YELLOW}[!] Пропускаем импорт ключей.${NC}"
    fi
fi

if [ -n "$SECRETS_DIR" ]; then
    echo -e "  ${GREEN}📁 Содержимое:${NC}"
    ls -la "$SECRETS_DIR" 2>/dev/null | grep -v "^total" | head -10
fi

# ═════════════════════════════════════════════
# ШАГ 2: Проверка Docker
# ═════════════════════════════════════════════
echo -e "\n[2/6] 🐳 Проверка Docker..."

if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}[!] Docker не найден. Устанавливаю...${NC}"
    curl -fsSL https://get.docker.com | bash
    sudo usermod -aG docker "${USER}"
    echo -e "${YELLOW}[!] Перезалогинься или выполни 'newgrp docker', затем запусти скрипт снова${NC}"
    exit 1
fi

if ! docker info &>/dev/null; then
    echo -e "${RED}[❌] Docker не запущен.${NC}"
    echo -e "  Запусти: sudo systemctl start docker"
    exit 1
fi

if ! docker compose version &>/dev/null; then
    echo -e "${YELLOW}[!] Устанавливаю docker compose...${NC}"
    sudo apt-get install -y docker-compose-plugin 2>/dev/null || \
    sudo pip3 install docker-compose 2>/dev/null || true
fi

echo -e "${GREEN}[✅] Docker готов${NC}"

# ═════════════════════════════════════════════
# ШАГ 3: Клонирование репозитория
# ═════════════════════════════════════════════
echo -e "\n[3/6] 📦 Клонирование/обновление репозитория..."

if [ -d "${INSTALL_DIR}" ]; then
    echo -e "${YELLOW}[!] Директория ${INSTALL_DIR} уже существует. Обновляю...${NC}"
    cd "${INSTALL_DIR}"
    git pull --rebase 2>/dev/null || (git fetch && git reset --hard origin/master)
else
    echo -e "${GREEN}[+] Клонирую репозиторий...${NC}"
    git clone "${REPO_URL}" "${INSTALL_DIR}"
    cd "${INSTALL_DIR}"
fi

# ═════════════════════════════════════════════
# ШАГ 4: Настройка .env
# ═════════════════════════════════════════════
echo -e "\n[4/6] 📝 Настройка .env..."

if [ -n "$SECRETS_DIR" ] && [ -f "${SECRETS_DIR}/.env" ]; then
    cp "${SECRETS_DIR}/.env" ".env"
    echo -e "${GREEN}[✅] .env скопирован из хранилища ключей${NC}"
elif [ ! -f ".env" ]; then
    echo -e "${GREEN}[+] Создаю .env с паролем по умолчанию...${NC}"
    JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || date +%s | md5sum | head -c 32)
    API_KEY_SECRET=$(openssl rand -hex 32 2>/dev/null || date +%s | md5sum | head -c 32)
    MACHINE_ID_SALT=$(openssl rand -hex 16 2>/dev/null || date +%s | md5sum | head -c 16)

    cat > .env << EOF
JWT_SECRET=${JWT_SECRET}
INITIAL_PASSWORD=9router
PORT=${PORT}
NODE_ENV=production
API_KEY_SECRET=${API_KEY_SECRET}
MACHINE_ID_SALT=${MACHINE_ID_SALT}
BASE_URL=http://localhost:${PORT}
NEXT_PUBLIC_BASE_URL=http://localhost:${PORT}
CLOUD_URL=https://9router.com
NEXT_PUBLIC_CLOUD_URL=https://9router.com
ENABLE_REQUEST_LOGS=false
OBSERVABILITY_ENABLED=true
AUTH_COOKIE_SECURE=false
REQUIRE_API_KEY=false
EOF
    echo -e "${GREEN}[+] .env создан. Пароль: 9router${NC}"
    echo -e "${YELLOW}[⚠️] Добавь свои API-ключи в .env вручную!${NC}"
else
    echo -e "${GREEN}[✅] .env уже существует${NC}"
fi

# ═════════════════════════════════════════════
# ШАГ 5: Сборка и запуск Docker
# ═════════════════════════════════════════════
echo -e "\n[5/6] 🏗️ Сборка и запуск 9router..."

# Создаём директории
mkdir -p data data-home

# Останавливаем старый контейнер
docker compose down 2>/dev/null || true

# Собираем и запускаем
docker compose up -d --build 2>&1 | grep -v "network" || true
echo -e "${GREEN}[✅] 9router запущен${NC}"

# Ждём готовности
echo -e "\n[⏳] Ожидание готовности..."
for i in $(seq 1 10); do
    sleep 3
    if curl -s -o /dev/null -w "%{http_code}" "http://localhost:${PORT}/" 2>/dev/null | grep -qE "200|301|302|401"; then
        echo -e "${GREEN}[✅] 9router готов на http://localhost:${PORT}${NC}"
        break
    fi
    if [ "$i" -eq 10 ]; then
        echo -e "${YELLOW}[⚠️] 9router не отвечает. Проверь: docker compose logs${NC}"
    fi
done

# ═════════════════════════════════════════════
# ШАГ 6: Импорт провайдеров из хранилища
# ═════════════════════════════════════════════
echo -e "\n[6/6] 🔌 Импорт провайдеров..."

if [ -n "$SECRETS_DIR" ] && [ -d "${SECRETS_DIR}/providers" ]; then
    echo -e "${CYAN}Импорт JSON-провайдеров из ${SECRETS_DIR}/providers/${NC}"
    for f in "${SECRETS_DIR}"/providers/*.json; do
        [ -f "$f" ] || continue
        filename=$(basename "$f")
        echo -n "    $filename ... "
        curl -s -X POST "http://localhost:${PORT}/api/providers/connection" \
            -H "Content-Type: application/json" \
            -d @"$f" > /dev/null 2>&1 && \
            echo -e "${GREEN}[✅]${NC}" || \
            echo -e "${YELLOW}[⚠️] ошибка${NC}"
    done
    echo -e "${GREEN}[✅] Провайдеры импортированы${NC}"
elif [ -f "add-ollama.json" ]; then
    echo -n "    Импорт add-ollama.json ... "
    curl -s -X POST "http://localhost:${PORT}/api/providers/connection" \
        -H "Content-Type: application/json" \
        -d @add-ollama.json > /dev/null 2>&1 && \
        echo -e "${GREEN}[✅]${NC}" || \
        echo -e "${YELLOW}[⚠️] ошибка${NC}"
else
    echo -e "${CYAN}[ℹ️] Нет файлов провайдеров для импорта${NC}"
    echo -e "  ${YELLOW}Положи JSON-файлы провайдеров в ${SECRETS_DIR:-<папка с ключами>}/providers/${NC}"
    echo -e "  ${YELLOW}Или добавь вручную через веб-интерфейс${NC}"
fi

# ─── ИТОГ ──────────────────────────────────
echo
echo -e "${CYAN}╔══════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  ✅ 9router-russian запущен!            ║${NC}"
echo -e "${CYAN}║  Адрес: http://localhost:${PORT}          ║${NC}"
echo -e "${CYAN}║  Пароль: 9router                         ║${NC}"
echo -e "${CYAN}╠══════════════════════════════════════════╣${NC}"
echo -e "${CYAN}║  🇷🇺 Фичи русской версии:               ║${NC}"
echo -e "${CYAN}║  • Vision Auto-Routing   👁️            ║${NC}"
echo -e "${CYAN}║  • RU Mode              🇷🇺            ║${NC}"
echo -e "${CYAN}║  • Smart Combo          🧠             ║${NC}"
echo -e "${CYAN}║  • Русский интерфейс   🔤              ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════╝${NC}"
echo
echo "📁 Установлено в: ${INSTALL_DIR}"
echo ""
echo "Полезные команды:"
echo "  cd ${INSTALL_DIR}"
echo "  docker compose logs -f  — логи"
echo "  docker compose down     — остановить"
echo "  docker compose up -d    — перезапустить"
echo "  node autonomous/swarm-master.js \"задача\" — ИИ-оркестратор"
echo ""
if [ -n "$SECRETS_DIR" ]; then
    echo "🔑 Хранилище ключей: ${SECRETS_DIR}"
    echo "   (скопируй эту папку на новый комп и укажи путь при установке)"
fi
echo ""