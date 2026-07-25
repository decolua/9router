#!/bin/bash
# ===========================================
#  9router Russian Auto Setup (Linux/Mac)
#  Одно-кликовое развёртывание
# ===========================================

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}"
echo "╔══════════════════════════════════════════╗"
echo "║    🚀 9router Russian Auto Setup         ║"
echo "║    Одно-кликовое развёртывание           ║"
echo "╚══════════════════════════════════════════╝"
echo -e "${NC}"

# ═════════════════════════════════════════════
# ШАГ 1: Поиск хранилища с ключами
# ═════════════════════════════════════════════
echo -e "\n[1/6] 🔑 Поиск хранилища с ключами..."
echo -e "  ${CYAN}Укажи путь к папке '9router-secrets', где лежат:${NC}"
echo -e "    • ${BOLD}.env${NC} — с API-ключами"
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
    echo -e "${GREEN}[✅] Используется SECRETS_STORAGE: $SECRETS_DIR${NC}"
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
            echo -e "${GREEN}[✅] Найдена папка с ключами: $SECRETS_DIR${NC}"
            break
        fi
    done
fi

# Если всё ещё не нашли — спрашиваем пользователя
if [ -z "$SECRETS_DIR" ]; then
    echo -e "${YELLOW}[⚠️] Папка '9router-secrets' не найдена автоматически.${NC}"
    echo -e "${CYAN}Укажи путь к ней вручную.${NC}"
    echo -e "${CYAN}Это может быть: Яндекс.Диск / Google Drive / USB-флешка / сетевая папка / rclone-монтирование ...${NC}"
    echo ""
    read -p "  Путь к папке 9router-secrets (Enter чтобы пропустить): " CUSTOM_PATH
    
    if [ -n "$CUSTOM_PATH" ]; then
        if [ -d "$CUSTOM_PATH" ]; then
            SECRETS_DIR="$CUSTOM_PATH"
            echo -e "${GREEN}[✅] Используется: $SECRETS_DIR${NC}"
            echo -e "  ${GREEN}📁 Содержимое:${NC}"
            ls -la "$SECRETS_DIR" 2>/dev/null | grep -v "^total" | head -10
        else
            echo -e "${RED}[❌] Папка не найдена: $CUSTOM_PATH${NC}"
            echo -e "${YELLOW}Пропускаем импорт ключей.${NC}"
        fi
    else
        echo -e "${YELLOW}[!] Пропускаем импорт ключей.${NC}"
    fi
fi

# ═════════════════════════════════════════════
# ШАГ 2: Копирование .env
# ═════════════════════════════════════════════
echo -e "\n[2/6] 📝 Настройка .env..."

if [ -n "$SECRETS_DIR" ] && [ -f "$SECRETS_DIR/.env" ]; then
    cp "$SECRETS_DIR/.env" .env
    echo -e "${GREEN}[✅] .env скопирован из хранилища ключей${NC}"
elif [ ! -f .env ]; then
    if [ -f .env.example ]; then
        cp .env.example .env
        echo -e "${YELLOW}[⚠️] .env создан из .env.example. Добавь свои API-ключи!${NC}"
    else
        echo -e "${RED}[❌] .env не найден!${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}[✅] .env уже существует${NC}"
fi

# ═════════════════════════════════════════════
# ШАГ 3: Проверка Docker
# ═════════════════════════════════════════════
echo -e "\n[3/6] 🐳 Проверка Docker..."

if ! docker info >/dev/null 2>&1; then
    echo -e "${RED}[❌] Docker не запущен!${NC}"
    echo "      Запусти Docker:"
    echo "        sudo systemctl start docker"
    echo "        sudo systemctl enable docker"
    echo "      Или установи: https://docs.docker.com/engine/install/"
    exit 1
fi
echo -e "${GREEN}[✅] Docker работает${NC}"

# ═════════════════════════════════════════════
# ШАГ 4: Сборка и запуск контейнера
# ═════════════════════════════════════════════
echo -e "\n[4/6] 🏗️ Сборка и запуск 9router..."

# Остановить старый
docker-compose down 2>/dev/null || true

# Создаём директории
mkdir -p data data-home

# Запускаем
docker-compose up -d --build 2>&1 | grep -v "network" || true

echo -e "${GREEN}[✅] 9router запущен${NC}"

# Ждём готовности
echo -e "\n[⏳] Ожидание готовности 9router..."
for i in $(seq 1 10); do
    sleep 3
    if curl -s -o /dev/null -w "%{http_code}" http://localhost:20128/ 2>/dev/null | grep -qE "200|301|302|401"; then
        echo -e "${GREEN}[✅] 9router готов на http://localhost:20128${NC}"
        break
    fi
    if [ "$i" -eq 10 ]; then
        echo -e "${YELLOW}[⚠️] 9router не отвечает. Проверь: docker-compose logs${NC}"
    fi
done

# ═════════════════════════════════════════════
# ШАГ 5: Импорт провайдеров
# ═════════════════════════════════════════════
echo -e "\n[5/6] 🔌 Импорт провайдеров..."

if [ -n "$SECRETS_DIR" ] && [ -d "$SECRETS_DIR/providers" ]; then
    echo "Импорт JSON-провайдеров из $SECRETS_DIR/providers/"
    for f in "$SECRETS_DIR"/providers/*.json; do
        filename=$(basename "$f")
        echo "    Загрузка: $filename"
        curl -s -X POST "http://localhost:20128/api/providers/connection" \
            -H "Content-Type: application/json" \
            -d @"$f" > /dev/null 2>&1 && \
            echo -e "${GREEN}    [✅] ${filename%.*} импортирован${NC}" || \
            echo -e "${YELLOW}    [⚠️] Ошибка импорта ${filename%.*}${NC}"
    done
    echo -e "${GREEN}[✅] Провайдеры импортированы${NC}"
else
    # Пробуем локальный JSON
    if [ -f "add-ollama.json" ]; then
        echo "    Импорт локального провайдера: add-ollama.json"
        curl -s -X POST "http://localhost:20128/api/providers/connection" \
            -H "Content-Type: application/json" \
            -d @add-ollama.json > /dev/null 2>&1
    fi
    echo -e "${YELLOW}[ℹ️] Провайдеры не импортированы (нет папки providers/)${NC}"
fi

# ═════════════════════════════════════════════
# ИТОГ
# ═════════════════════════════════════════════
echo -e "\n${GREEN}"
echo "╔══════════════════════════════════════════╗"
echo "║    🎉 9router RUSSIAN ЗАПУЩЕН!          ║"
echo "╠══════════════════════════════════════════╣"
echo "║  📋 Сайт:    http://localhost:20128      ║"
echo "║  🔑 API:     http://localhost:20128/api/v1 ║"
echo "║  🐳 Docker:  9router (Up)               ║"
echo "╚══════════════════════════════════════════╝"
echo -e "${NC}"
echo ""
echo "Полезные команды:"
echo "  docker-compose logs -f        — логи"
echo "  docker-compose down           — остановить"
echo "  docker-compose up -d          — перезапустить"
echo "  node autonomous/swarm-master.js \"задача\" — ИИ-оркестратор"
echo ""
if [ -n "$SECRETS_DIR" ]; then
    echo "📁 Хранилище ключей: $SECRETS_DIR"
    echo "   (скопируй эту папку на новый комп и укажи путь при установке)"
fi
echo ""