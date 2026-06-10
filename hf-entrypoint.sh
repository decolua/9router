#!/bin/sh
# Hugging Face Spaces auto-configuration
# This entrypoint auto-detects HF Space URL so you don't need to manually set BASE_URL

if [ -z "$BASE_URL" ] && [ -n "$SPACE_HOST" ]; then
  export BASE_URL="https://${SPACE_HOST}"
  echo "[HF Auto-Config] BASE_URL=${BASE_URL}"
fi

if [ -z "$NEXT_PUBLIC_BASE_URL" ] && [ -n "$SPACE_HOST" ]; then
  export NEXT_PUBLIC_BASE_URL="https://${SPACE_HOST}"
  echo "[HF Auto-Config] NEXT_PUBLIC_BASE_URL=${NEXT_PUBLIC_BASE_URL}"
fi

# Ensure data directories exist and are owned by node
chown -R node:node /app/data /app/data-home 2>/dev/null || true

exec su-exec node "$@"
