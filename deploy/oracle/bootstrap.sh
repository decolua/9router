#!/usr/bin/env bash
# Bootstrap Docker on a fresh Ubuntu Oracle Cloud VM.
# Run on the server: curl -fsSL ... | bash   OR   ./bootstrap.sh
set -euo pipefail

step() { echo ""; echo "==> $*"; }

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Run as ubuntu (not root). Script uses sudo where needed." >&2
  exit 1
fi

step "Installing Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER"
  echo "Docker installed. Log out and SSH back in, then run deploy steps from deploy/oracle/README.md"
else
  echo "Docker already installed: $(docker --version)"
fi

step "Opening port 20128 (iptables)"
if command -v iptables >/dev/null 2>&1; then
  sudo iptables -C INPUT -p tcp --dport 20128 -j ACCEPT 2>/dev/null || \
    sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 20128 -j ACCEPT
  if command -v netfilter-persistent >/dev/null 2>&1; then
    sudo netfilter-persistent save
  fi
  echo "Port 20128 allowed in iptables"
else
  echo "Configure port 20128 in Oracle Security List (see deploy/oracle/README.md)"
fi

echo ""
echo "Next steps:"
echo "  1. Clone repo or copy deploy/saas + deploy/oracle to this server"
echo "  2. cp deploy/oracle/.env.example deploy/saas/.env"
echo "  3. Edit .env (YOUR_PUBLIC_IP, EBROUTER_IMAGE, secrets)"
echo "  4. cd deploy/saas && ./install.sh"
echo ""
echo "Docs: deploy/oracle/README.md"
