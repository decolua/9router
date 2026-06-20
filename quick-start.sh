#!/usr/bin/env bash
set -euo pipefail

# 9Router Quick Start — Linux (systemd)
# One command: curl -fsSL https://raw.githubusercontent.com/mdn77/9router-russian/master/quick-start.sh | bash

REPO="https://github.com/mdn77/9router-russian.git"
INSTALL_DIR="${INSTALL_DIR:-/opt/9router}"
DATA_DIR="${DATA_DIR:-/var/lib/9router}"
PORT="${PORT:-20128}"
JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 32)}"
PASSWORD="${PASSWORD:-admin}"

echo "==> 9Router Quick Start (Linux)"

# 1. Check Node.js
if ! command -v node &>/dev/null; then
  echo "==> Installing Node.js..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# 2. Clone / update
if [ -d "$INSTALL_DIR" ]; then
  echo "==> Updating existing installation..."
  cd "$INSTALL_DIR"
  git pull
else
  echo "==> Cloning..."
  git clone "$REPO" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# 3. Install dependencies + build
npm install
npm run build

# 4. .env
cat > .env <<ENVEOF
NODE_ENV=production
PORT=$PORT
HOSTNAME=0.0.0.0
DATA_DIR=$DATA_DIR
JWT_SECRET=$JWT_SECRET
INITIAL_PASSWORD=$PASSWORD
ENVEOF

# 5. systemd service
sudo tee /etc/systemd/system/9router.service > /dev/null <<UNIT
[Unit]
Description=9Router — FREE AI Router (Russian Edition)
After=network-online.target

[Service]
Type=exec
User=root
WorkingDirectory=$INSTALL_DIR
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=HOSTNAME=0.0.0.0
Environment=DATA_DIR=$DATA_DIR
Environment=JWT_SECRET=$JWT_SECRET
Environment=INITIAL_PASSWORD=$PASSWORD
ExecStart=$(which node) $INSTALL_DIR/node_modules/.bin/next start --port $PORT
Restart=always
RestartSec=10
MemoryMax=2G

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable 9router
sudo systemctl restart 9router

echo ""
echo "=========================================="
echo "  9Router запущен!"
echo "  Dashboard: http://localhost:$PORT"
echo "  API:       http://localhost:$PORT/v1"
echo "  Пароль:    $PASSWORD"
echo "=========================================="
echo ""
echo "  Команды:"
echo "    sudo systemctl status 9router"
echo "    sudo journalctl -u 9router -f"
echo "    sudo systemctl restart 9router"
