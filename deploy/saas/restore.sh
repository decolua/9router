#!/usr/bin/env bash
# Restore PostgreSQL from a backup .sql file created by backup.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

SQL_FILE="${1:-}"
if [[ -z "$SQL_FILE" || ! -f "$SQL_FILE" ]]; then
  echo "Usage: $0 <backup.sql>" >&2
  exit 1
fi

compose_cmd() {
  if docker compose version >/dev/null 2>&1; then echo "docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then echo "docker-compose"
  else echo "Docker Compose not found" >&2; exit 1; fi
}

get_env_val() {
  grep -E "^${1}=" "$ROOT/.env" 2>/dev/null | head -1 | cut -d= -f2- || true
}

COMPOSE=$(compose_cmd)
DB_USER=$(get_env_val POSTGRES_USER)
DB_NAME=$(get_env_val POSTGRES_DB)
DB_USER=${DB_USER:-ebrouter}
DB_NAME=${DB_NAME:-ebrouter}

echo "WARNING: This replaces all data in database '$DB_NAME' (all organizations)."
read -r -p "Type RESTORE to continue: " confirm
if [[ "$confirm" != "RESTORE" ]]; then echo "Aborted"; exit 1; fi

echo "Stopping ebRouter app..."
$COMPOSE stop ebrouter

echo "Restoring from $SQL_FILE ..."
$COMPOSE exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 < "$SQL_FILE"

echo "Starting ebRouter..."
$COMPOSE start ebrouter

echo "Restore complete. Verify: curl -fsS https://$(get_env_val SAAS_BASE_DOMAIN)/api/health"
