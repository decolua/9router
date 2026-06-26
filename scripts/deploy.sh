#!/usr/bin/env bash
# Build 9router from source and deploy to the standalone runtime dir,
# then restart the systemd user service.
#
# Tailored to this server's setup (see memory: 9router-deployment):
#   - Source:        /home/ram/Projects/9router      (git, deploy-custom branch)
#   - Deploy dir:    /home/ram/Projects/9router-deploy
#   - Data dir:      /home/ram/Projects/9router-data (SQLite DB — NEVER touched here)
#   - Process mgr:   systemd --user service 9router.service
#   - Base path:     /9router  (via NINEROUTER_BASE_PATH -> Next basePath)
#
# The DB (provider configs, passwords, apiKeys) lives outside the deploy dir
# and is never modified by this script. Next auto-migrates it on boot, with a
# backup under 9router-data/db/backups/.
#
# Usage:
#   scripts/deploy.sh             # build + deploy + restart
#   scripts/deploy.sh --no-build  # redeploy current build without rebuilding
#   scripts/deploy.sh --restart   # just restart the service (no file changes)

set -euo pipefail

SOURCE_DIR="/home/ram/Projects/9router"
DEPLOY_DIR="/home/ram/Projects/9router-deploy"
BASE_PATH="${NINEROUTER_BASE_PATH:-/9router}"
SERVICE="9router.service"

DO_BUILD=1
DO_RESTART=1
for arg in "$@"; do
  case "$arg" in
    --no-build) DO_BUILD=0 ;;
    --restart)  DO_BUILD=0; DO_RESTART=1 ;; # already default; kept for clarity
    --no-restart) DO_RESTART=0 ;;
    -h|--help)
      sed -n '2,28p' "$0"; exit 0 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

cd "$SOURCE_DIR"

echo "==> source: $SOURCE_DIR  branch: $(git rev-parse --abbrev-ref HEAD)  HEAD: $(git rev-parse --short HEAD)"

if [[ "$DO_BUILD" -eq 1 ]]; then
  echo "==> building (NINEROUTER_BASE_PATH=$BASE_PATH)..."
  rm -rf .next
  NINEROUTER_BASE_PATH="$BASE_PATH" npm run build
fi

[[ -d .next/standalone ]] || { echo "ERROR: .next/standalone missing — run with build" >&2; exit 1; }
[[ -d .next/static ]]     || { echo "ERROR: .next/static missing — build incomplete" >&2; exit 1; }

echo "==> refreshing deploy dir: $DEPLOY_DIR"
mkdir -p "$DEPLOY_DIR"
# Standalone output: server.js, .next (manifests + server), node_modules, package.json, src/
rsync -a --delete .next/standalone/ "$DEPLOY_DIR/"
# open-sse is not traced into standalone — copy loose.
rsync -a           open-sse/         "$DEPLOY_DIR/open-sse/"
# IP-deriving wrapper around the standalone server.
cp -f custom-server.js               "$DEPLOY_DIR/custom-server.js"
# CRITICAL: standalone does NOT include _next/static (CSS/JS/fonts).
# Must exist BEFORE restart or Next disables static serving at boot
# (pages render blank, _next/static/* -> 404).
rm -rf "$DEPLOY_DIR/.next/static"
cp -a .next/static                   "$DEPLOY_DIR/.next/static"

echo "==> deploy contents:"
ls -1 "$DEPLOY_DIR"
echo "    static: $(test -d "$DEPLOY_DIR/.next/static" && echo present || echo MISSING)"

if [[ "$DO_RESTART" -eq 1 ]]; then
  echo "==> restarting $SERVICE"
  systemctl --user restart "$SERVICE"
  sleep 4
  systemctl --user is-active "$SERVICE" >/dev/null && echo "    service active" || {
    echo "ERROR: service not active" >&2
    journalctl --user -u "$SERVICE" -n 30 --no-pager >&2
    exit 1
  }
  echo "==> recent log:"
  journalctl --user -u "$SERVICE" -n 6 --no-pager | sed 's/^/    /'
fi

echo "==> done. waiting for server warmup..."
# Next reports "Ready in 0ms" but static route registration lags by a second
# or two; probing immediately post-restart can falsely 404. Poll until /login
# answers 200 (or timeout).
ok=""
for i in $(seq 1 10); do
  code=$(curl -s -m 5 -o /dev/null -w "%{http_code}" "http://127.0.0.1:20128$BASE_PATH/login" || echo 000)
  if [[ "$code" == "200" ]]; then ok=1; break; fi
  sleep 1
done
[[ -n "$ok" ]] || echo "    WARN: /login not 200 after 10s (still warming up?)"

echo "==> smoke test (public):"
# Static-route registration can lag ~1s post-restart (transient 404 that
# clears on its own). Retry each probe a few times before reporting.
probe() {
  local label="$1" url="$2" code
  for i in 1 2 3 4 5; do
    code=$(curl -s -m 15 -o /dev/null -w "%{http_code}" "$url" || echo 000)
    [[ "$code" == "200" ]] && break
    sleep 1
  done
  printf "    %-8s %s\n" "$label:" "$code"
}
probe login "https://demo.ssoni.top$BASE_PATH/login"
probe css    "https://demo.ssoni.top$BASE_PATH/_next/static/css/$(ls .next/static/css | head -1)"
probe models "https://demo.ssoni.top$BASE_PATH/api/version"
