#!/usr/bin/env bash
# Convenience wrapper around docker compose. Use `docker compose up -d` directly
# if you prefer.
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "ERROR: .env not found. Copy .env.example to .env and edit secrets first." >&2
  exit 1
fi

mkdir -p ./data

docker compose down --remove-orphans
docker compose build
docker compose up -d
docker compose ps
echo
echo "9router is starting on http://localhost:20128"
echo "Tail logs with:  docker compose logs -f"
