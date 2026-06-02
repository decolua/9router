#!/bin/bash
# 9router-russian — One-command install
# curl -fsSL https://raw.githubusercontent.com/mdn77/9router-russian/master/install-russian.sh | bash

set -e

REPO_URL="https://github.com/mdn77/9router-russian.git"
INSTALL_DIR="${HOME}/9router-russian"
PORT="20128"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}"
echo "╔══════════════════════════════════════════╗"
echo "║    9router-russian — Russian Edition     ║"
echo "║    🇷🇺  Русская версия 9router            ║"
echo "╚══════════════════════════════════════════╝"
echo -e "${NC}"

# ─── Проверка Docker ──────────────────────────────────────────────────────────
if ! command -v docker &> /dev/null; then
  echo -e "${YELLOW}[!] Docker не найден. Устанавливаю Docker...${NC}"
  curl -fsSL https://get.docker.com | bash
  sudo usermod -aG docker "${USER}"
  echo -e "${YELLOW}[!] Перезалогинься или запусти 'newgrp docker', затем запусти скрипт снова${NC}"
  exit 1
fi

if ! docker compose version &> /dev/null; then
  echo -e "${YELLOW}[!] docker compose не найден. Устанавливаю...${NC}"
  sudo apt-get install -y docker-compose-plugin || true
fi

# ─── Клонирование ─────────────────────────────────────────────────────────────
if [ -d "${INSTALL_DIR}" ]; then
  echo -e "${YELLOW}[!] Директория ${INSTALL_DIR} уже существует. Обновляю...${NC}"
  cd "${INSTALL_DIR}"
  git pull
else
  echo -e "${GREEN}[+] Клонирую репозиторий...${NC}"
  git clone "${REPO_URL}" "${INSTALL_DIR}"
  cd "${INSTALL_DIR}"
fi

# ─── .env ─────────────────────────────────────────────────────────────────────
if [ ! -f ".env" ]; then
  echo -e "${GREEN}[+] Создаю .env с паролем по умолчанию...${NC}"
  JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || date +%s | md5sum | head -c 32)
  API_KEY_SECRET=$(openssl rand -hex 32 2>/dev/null || date +%s | md5sum | head -c 32)
  MACHINE_ID_SALT=$(openssl rand -hex 16 2>/dev/null || date +%s | md5sum | head -c 16)

  cat > .env << EOF
JWT_SECRET=${JWT_SECRET}
INITIAL_PASSWORD=9router
DATA_DIR=./data
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
fi

# ─── docker-compose.yml ──────────────────────────────────────────────────────
if [ ! -f "docker-compose.yml" ]; then
  cat > docker-compose.yml << EOF
version: "3.9"

services:
  web:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: 9router
    ports:
      - "${PORT}:${PORT}"
    volumes:
      - 9router-data:/app/data
    environment:
      - DATA_DIR=/app/data
      - PORT=${PORT}
      - HOSTNAME=0.0.0.0
      - NODE_ENV=production
      - NEXT_TELEMETRY_DISABLED=1
      - JWT_SECRET=\${JWT_SECRET}
      - INITIAL_PASSWORD=\${INITIAL_PASSWORD}
      - API_KEY_SECRET=\${API_KEY_SECRET}
      - MACHINE_ID_SALT=\${MACHINE_ID_SALT}
      - BASE_URL=http://localhost:${PORT}
      - NEXT_PUBLIC_BASE_URL=http://localhost:${PORT}
      - CLOUD_URL=https://9router.com
      - NEXT_PUBLIC_CLOUD_URL=https://9router.com
      - ENABLE_REQUEST_LOGS=false
      - OBSERVABILITY_ENABLED=true
      - AUTH_COOKIE_SECURE=false
      - REQUIRE_API_KEY=false
    restart: unless-stopped

volumes:
  9router_data:
EOF
fi

# ─── Сборка и запуск ────────────────────────────────────────────────────────
echo -e "${GREEN}[+] Собираю образ...${NC}"
docker compose build web

echo -e "${GREEN}[+] Запускаю контейнер...${NC}"
docker compose up -d web

# ─── Проверка ───────────────────────────────────────────────────────────────
echo -e "${GREEN}[+] Проверяю...${NC}"
sleep 3
if curl -s "http://localhost:${PORT}/api/version" &> /dev/null; then
  VERSION=$(curl -s "http://localhost:${PORT}/api/version" | grep -o '"currentVersion":"[^"]*"' | cut -d'"' -f4)
  echo
  echo -e "${CYAN}╔══════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║  ✅ 9router-russian запущен!            ║${NC}"
  echo -e "${CYAN}║  Версия: ${VERSION}                       ║${NC}"
  echo -e "${CYAN}║  Адрес: http://localhost:${PORT}          ║${NC}"
  echo -e "${CYAN}║  Пароль: 9router                         ║${NC}"
  echo -e "${CYAN}║                                          ║${NC}"
  echo -e "${CYAN}║  🇷🇺 Фичи форка:                         ║${NC}"
  echo -e "${CYAN}║  • Vision Auto-Routing 👁️               ║${NC}"
  echo -e "${CYAN}║  • RU Mode 🇷🇺                          ║${NC}"
  echo -e "${CYAN}║  • Smart Combo 🧠                       ║${NC}"
  echo -e "${CYAN}║  • Русский язык 🔤                      ║${NC}"
  echo -e "${CYAN}║  • OpenCode Free по умолчанию 🆓        ║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════╝${NC}"
else
  echo -e "${YELLOW}[!] Что-то пошло не так. Проверь логи: docker compose logs web${NC}"
fi
