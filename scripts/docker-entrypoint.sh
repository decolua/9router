#!/bin/sh
set -e

# When DATABASE_URL is set: wait for Postgres (host:port), then run migrations once
if [ -n "$DATABASE_URL" ]; then
  # Parse host from DATABASE_URL (e.g. postgres://user:pass@postgres:5432/db -> postgres)
  host="${DATABASE_URL#*@}"
  host="${host%%:*}"
  host="${host%%/*}"
  port=5432
  echo "Waiting for database at $host:$port..."
  while ! nc -z "$host" "$port" 2>/dev/null; do
    sleep 2
  done
  echo "Running migrations..."
  node scripts/db/migrate.js
fi

exec node server.js
