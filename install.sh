#!/usr/bin/env sh
# 9router (fahmi0812 fork, Kiro fix) installer for Linux/macOS
# Usage: curl -fsSL https://raw.githubusercontent.com/fahmi0812/9router/kiro-fix/install.sh | sh
set -e
command -v npm >/dev/null || { echo "Install Node.js >= 20 first: https://nodejs.org"; exit 1; }
pkill -f "9router/cli.js" 2>/dev/null || true
npm install -g https://github.com/fahmi0812/9router/releases/latest/download/9router-kiro.tgz
echo "Done. Start with: 9router --skip-update"
