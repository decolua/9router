#!/usr/bin/env bash
# Backup PostgreSQL database for ebRouter client deployment.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

OUT_DIR="${1:-$ROOT/backups}"
mkdir -p "$OUT_DIR"

compose_cmd() {
  if docker compose version >/dev/null 2>&1; then echo "docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then echo "docker-compose"
  else echo "Docker Compose not found" >&2; exit 1; fi
}

get_env_val() {
  grep -E "^${1}=" "$ROOT/.env" 2>/dev/null | head -1 | cut -d= -f2- || true
}

COMPOSE=$(compose_cmd)
STAMP=$(date +%Y%m%d-%H%M%S)
DB_USER=$(get_env_val POSTGRES_USER)
DB_NAME=$(get_env_val POSTGRES_DB)
DB_USER=${DB_USER:-ebrouter}
DB_NAME=${DB_NAME:-ebrouter}

SQL_FILE="$OUT_DIR/ebrouter-${STAMP}.sql"
META_FILE="$OUT_DIR/env-reference-${STAMP}.txt"

echo "Backing up PostgreSQL to $SQL_FILE ..."
$COMPOSE exec -T postgres pg_dump -U "$DB_USER" -d "$DB_NAME" --clean --if-exists --no-owner --no-acl > "$SQL_FILE"

cat > "$META_FILE" <<EOF
ebRouter backup $STAMP
Database: $DB_NAME
User: $DB_USER

IMPORTANT: Store .env separately in a secure location (contains secrets).
To restore: ./restore.sh "$SQL_FILE"
EOF

echo "Done."
echo "  SQL backup : $SQL_FILE"
echo "  Also secure: $ROOT/.env"

# Prune backups older than 30 days (enterprise retention policy)
find "$OUT_DIR" -type f \( -name 'ebrouter-*.sql' -o -name 'env-reference-*.txt' \) -mtime +30 -delete 2>/dev/null || true
echo "Pruned backups older than 30 days in $OUT_DIR"
