#!/usr/bin/env bash
# First-time install for ebRouter SaaS (Docker Compose + PostgreSQL + optional Caddy TLS).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

FORCE_ENV=0
SKIP_PULL=0
WITH_PROXY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force-env) FORCE_ENV=1; shift ;;
    --skip-pull) SKIP_PULL=1; shift ;;
    --with-proxy) WITH_PROXY=1; shift ;;
    -h|--help)
      echo "Usage: $0 [--force-env] [--skip-pull] [--with-proxy]"
      echo "  --with-proxy  Start Caddy reverse proxy (ports 80/443, wildcard TLS)"
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
  echo "Docker is not installed. Install Docker Engine first." >&2
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

  val=$(get_env_val "MASTER_KEY" "$ENV_FILE")
  [[ -z "$val" ]] && set_env_val "MASTER_KEY" "$(rand_b64)" "$ENV_FILE"

  ok "Created .env with generated secrets"
fi

SAAS_DOMAIN=$(get_env_val "SAAS_BASE_DOMAIN" "$ENV_FILE")
if [[ "$SAAS_DOMAIN" == "app.example.com" || -z "$SAAS_DOMAIN" ]]; then
  read -r -p "SaaS base domain (e.g. app.example.com): " input_domain
  if [[ -n "$input_domain" ]]; then
    set_env_val "SAAS_BASE_DOMAIN" "$input_domain" "$ENV_FILE"
    set_env_val "BASE_URL" "https://${input_domain}" "$ENV_FILE"
    set_env_val "NEXT_PUBLIC_BASE_URL" "https://${input_domain}" "$ENV_FILE"
    SAAS_DOMAIN="$input_domain"
  fi
fi

if [[ "$WITH_PROXY" -eq 1 ]]; then
  token=$(get_env_val "CLOUDFLARE_API_TOKEN" "$ENV_FILE")
  if [[ -z "$token" ]]; then
    warn "Set CLOUDFLARE_API_TOKEN in .env before starting (wildcard TLS via DNS challenge)"
  fi
  email=$(get_env_val "ACME_EMAIL" "$ENV_FILE")
  if [[ -z "$email" || "$email" == "ops@example.com" ]]; then
    read -r -p "ACME email for Let's Encrypt: " input_email
    [[ -n "$input_email" ]] && set_env_val "ACME_EMAIL" "$input_email" "$ENV_FILE"
  fi
fi

step "Starting ebRouter SaaS stack"
PROFILE_ARGS=()
if [[ "$WITH_PROXY" -eq 1 ]]; then
  PROFILE_ARGS=(--profile proxy)
fi

if [[ "$SKIP_PULL" -eq 0 ]]; then
  $COMPOSE "${PROFILE_ARGS[@]}" pull
fi
$COMPOSE "${PROFILE_ARGS[@]}" up -d --build

step "Waiting for health checks"
deadline=$((SECONDS + 180))
healthy=0
while [[ $SECONDS -lt $deadline ]]; do
  sleep 5
  if curl -sf "http://127.0.0.1:20128/api/health" >/dev/null 2>&1; then
    healthy=1
    break
  fi
done

echo ""
echo "========================================"
echo " ebRouter SaaS is installed"
echo "========================================"
echo ""
if [[ "$WITH_PROXY" -eq 1 ]]; then
  echo "  Dashboard : https://${SAAS_DOMAIN}/dashboard"
  echo "  Register  : https://${SAAS_DOMAIN}/register"
else
  echo "  Dashboard : http://127.0.0.1:20128/dashboard"
  echo "  Register  : http://127.0.0.1:20128/register"
  echo "  (Production: re-run with --with-proxy after DNS is configured)"
fi
echo ""
echo "  Orgs use subdomains: https://{slug}.${SAAS_DOMAIN}"
echo "  Dev path fallback:   /o/{slug}/..."
echo ""
echo "  Back up .env and run ./backup.sh regularly."
echo "  See SAAS-OPS.md for TLS, upgrades, and rate limits."
echo ""
if [[ "$healthy" -eq 0 ]]; then
  warn "Health check still pending — run: $COMPOSE ps"
  warn "Logs: $COMPOSE logs -f ebrouter"
fi
