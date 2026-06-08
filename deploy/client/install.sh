#!/usr/bin/env bash
# First-time install for ebRouter client bundle (Docker Compose + PostgreSQL).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

FORCE_ENV=0
SKIP_PULL=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force-env) FORCE_ENV=1; shift ;;
    --skip-pull) SKIP_PULL=1; shift ;;
    -h|--help)
      echo "Usage: $0 [--force-env] [--skip-pull]"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

step() { echo ""; echo "==> $*"; }
ok()   { echo "    $*"; }
warn() { echo "    WARNING: $*"; }

rand_hex() {
  local bytes="${1:-32}"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$bytes"
  else
    head -c "$bytes" /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

rand_b64() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 32
  else
    head -c 32 /dev/urandom | base64 | tr -d '\n'
  fi
}

rand_password() {
  local len="${1:-16}"
  tr -dc 'a-zA-Z2-9' </dev/urandom | head -c "$len"
  echo
}

compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    echo "docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then
    echo "docker-compose"
  else
    echo "ERROR: Docker Compose not found." >&2
    exit 1
  fi
}

get_env_val() {
  local key="$1"
  local file="$2"
  grep -E "^${key}=" "$file" 2>/dev/null | head -1 | cut -d= -f2- || true
}

set_env_val() {
  local key="$1"
  local val="$2"
  local file="$3"
  if grep -qE "^${key}=" "$file"; then
    if [[ "$(uname)" == "Darwin" ]]; then
      sed -i '' "s|^${key}=.*|${key}=${val}|" "$file"
    else
      sed -i "s|^${key}=.*|${key}=${val}|" "$file"
    fi
  else
    echo "${key}=${val}" >> "$file"
  fi
}

step "Checking Docker"
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed. Install Docker Desktop or Docker Engine first." >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Start Docker and retry." >&2
  exit 1
fi
COMPOSE=$(compose_cmd)
ok "Compose: $COMPOSE"

step "Preparing environment file"
ENV_FILE="$ROOT/.env"
EXAMPLE="$ROOT/.env.example"
if [[ ! -f "$EXAMPLE" ]]; then
  echo ".env.example not found" >&2
  exit 1
fi

if [[ -f "$ENV_FILE" && "$FORCE_ENV" -eq 0 ]]; then
  warn ".env already exists — keeping it (use --force-env to regenerate)"
else
  [[ -f "$ENV_FILE" && "$FORCE_ENV" -eq 1 ]] && warn "Regenerating .env (--force-env)"
  cp "$EXAMPLE" "$ENV_FILE"

  for key in POSTGRES_PASSWORD JWT_SECRET API_KEY_SECRET MACHINE_ID_SALT; do
    val=$(get_env_val "$key" "$ENV_FILE")
    if [[ -z "$val" ]]; then
      if [[ "$key" == "MACHINE_ID_SALT" ]]; then
        set_env_val "$key" "$(rand_hex 16)" "$ENV_FILE"
      else
        set_env_val "$key" "$(rand_hex 32)" "$ENV_FILE"
      fi
    fi
  done

  val=$(get_env_val "INITIAL_PASSWORD" "$ENV_FILE")
  [[ -z "$val" ]] && set_env_val "INITIAL_PASSWORD" "$(rand_password 16)" "$ENV_FILE"

  val=$(get_env_val "MASTER_KEY" "$ENV_FILE")
  [[ -z "$val" ]] && set_env_val "MASTER_KEY" "$(rand_b64)" "$ENV_FILE"

  ok "Created .env with generated secrets"
fi

PORT=$(get_env_val "PORT" "$ENV_FILE")
PORT=${PORT:-20128}
INITIAL_PASSWORD=$(get_env_val "INITIAL_PASSWORD" "$ENV_FILE")

step "Starting ebRouter stack"
if [[ "$SKIP_PULL" -eq 0 ]]; then
  $COMPOSE pull
fi
$COMPOSE up -d

step "Waiting for health checks"
deadline=$((SECONDS + 180))
healthy=0
while [[ $SECONDS -lt $deadline ]]; do
  sleep 5
  if curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    healthy=1
    break
  fi
done

echo ""
echo "========================================"
echo " ebRouter is installed"
echo "========================================"
echo ""
echo "  Dashboard : http://localhost:${PORT}/dashboard"
echo "  API       : http://localhost:${PORT}/v1"
echo "  Password  : ${INITIAL_PASSWORD}"
echo ""
echo "  Change the password after first login (Settings)."
echo "  Back up .env and run ./backup.sh regularly."
echo ""
if [[ "$healthy" -eq 0 ]]; then
  warn "Health check still pending — run: $COMPOSE ps"
  warn "Logs: $COMPOSE logs -f ebrouter"
fi
