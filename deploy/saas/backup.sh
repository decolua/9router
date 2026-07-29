#!/usr/bin/env bash
# Backup PostgreSQL for ebRouter SaaS deployment.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

OUT_DIR="${1:-$ROOT/backups}"
RETENTION_DAYS="${EBROUTER_BACKUP_RETENTION_DAYS:-30}"
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
SAAS_DOMAIN=$(get_env_val SAAS_BASE_DOMAIN)

SQL_FILE="$OUT_DIR/ebrouter-saas-${STAMP}.sql"
META_FILE="$OUT_DIR/ebrouter-saas-${STAMP}.meta.txt"

echo "Backing up PostgreSQL to $SQL_FILE ..."
$COMPOSE exec -T postgres pg_dump -U "$DB_USER" -d "$DB_NAME" --clean --if-exists --no-owner --no-acl > "$SQL_FILE"

cat > "$META_FILE" <<EOF
ebRouter SaaS backup $STAMP
Database: $DB_NAME
User: $DB_USER
SAAS_BASE_DOMAIN: ${SAAS_DOMAIN:-unknown}

IMPORTANT: Store .env separately in a secure location (contains secrets).
To restore: ./restore.sh "$SQL_FILE"
EOF

echo "Done."
echo "  SQL backup : $SQL_FILE"
echo "  Metadata   : $META_FILE"
echo "  Also secure: $ROOT/.env"

find "$OUT_DIR" -type f \( -name 'ebrouter-saas-*.sql' -o -name 'ebrouter-saas-*.meta.txt' \) -mtime +"$RETENTION_DAYS" -delete 2>/dev/null || true
echo "Pruned backups older than ${RETENTION_DAYS} days in $OUT_DIR"
