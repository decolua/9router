#!/bin/sh
set -e

# Fix permissions for mounted volumes (may be owned by root on host)
chown -R bun:bun /app/data /app/data-home 2>/dev/null || true

# Execute CMD as bun user
exec su-exec bun "$@"