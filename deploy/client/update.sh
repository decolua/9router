#!/usr/bin/env bash
# Pull a newer ebRouter image and restart (PostgreSQL data is preserved).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

IMAGE="${1:-}"

compose_cmd() {
  if docker compose version >/dev/null 2>&1; then echo "docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then echo "docker-compose"
  else echo "Docker Compose not found" >&2; exit 1; fi
}

set_env_val() {
  local key="$1" val="$2" file="$ROOT/.env"
  if grep -qE "^${key}=" "$file"; then
    if [[ "$(uname)" == "Darwin" ]]; then sed -i '' "s|^${key}=.*|${key}=${val}|" "$file"
    else sed -i "s|^${key}=.*|${key}=${val}|" "$file"; fi
  else
    echo "${key}=${val}" >> "$file"
  fi
}

COMPOSE=$(compose_cmd)

if [[ -n "$IMAGE" ]]; then
  echo "Setting EBROUTER_IMAGE=$IMAGE in .env"
  set_env_val EBROUTER_IMAGE "$IMAGE"
fi

echo "Pulling images..."
$COMPOSE pull

echo "Recreating containers (volumes unchanged)..."
$COMPOSE up -d

PORT=$(grep -E '^PORT=' "$ROOT/.env" 2>/dev/null | cut -d= -f2- || echo 20128)
PORT=${PORT:-20128}

echo ""
echo "Update complete. Dashboard: http://localhost:${PORT}/dashboard"
echo "Check version: curl -s http://localhost:${PORT}/api/version"
