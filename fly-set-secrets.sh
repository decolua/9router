#!/usr/bin/env bash
# One-shot: push the secrets from .env into Fly. Run once, after `flyctl launch --no-deploy`.
# Idempotent — re-running rotates secrets and triggers a rolling restart.
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "ERROR: .env not found. Generate it first." >&2
  exit 1
fi

# Pull values out of .env without sourcing it (avoids exporting unrelated vars to your shell).
get() { grep -E "^$1=" .env | head -n1 | cut -d= -f2-; }

JWT_SECRET="$(get JWT_SECRET)"
INITIAL_PASSWORD="$(get INITIAL_PASSWORD)"
API_KEY_SECRET="$(get API_KEY_SECRET)"
MACHINE_ID_SALT="$(get MACHINE_ID_SALT)"

for var in JWT_SECRET INITIAL_PASSWORD API_KEY_SECRET MACHINE_ID_SALT; do
  if [ -z "${!var}" ]; then
    echo "ERROR: $var is empty in .env" >&2
    exit 1
  fi
done

flyctl secrets set \
  JWT_SECRET="$JWT_SECRET" \
  INITIAL_PASSWORD="$INITIAL_PASSWORD" \
  API_KEY_SECRET="$API_KEY_SECRET" \
  MACHINE_ID_SALT="$MACHINE_ID_SALT"

echo
echo "Secrets pushed. Run 'flyctl deploy' next."
