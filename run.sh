#!/usr/bin/env bash
# Build, deploy, and restart the 9router user service with the Claude classifier compat patch.
#
# Why this script exists:
#   The cli build script (cli/scripts/build-cli.js) writes the Next.js
#   standalone bundle AND its static assets into
#     ./.next-cli-build/standalone/9router/.next-cli-build/  (the nested
#   build) and into  ./cli/app/.next-cli-build/  (the cli package).
#
#   But the systemd service runs from
#     /home/ron/Documents/Projects/9router/.next-cli-build/standalone/9router
#   and reads its `distDir: ./.next-cli-build` from there, so the live
#   service bundle under that path needs to contain the static assets too.
#   Without them, /_next/static/* returns 404 and the dashboard renders
#   unstyled / missing assets.
#
#   The cli build also writes the source `public/` (favicon, provider icons,
#   i18n, sw.js) into ./cli/app/public, but Next.js standalone looks for
#   `public/` at $WorkingDirectory of the server. So we must mirror
#   ./cli/app/public  →  <service>/public  or the dashboard shows broken icons.
#
#   `systemctl --user restart` sometimes leaves the old `next-server` PID
#   holding port 20128 / files open during hot reload. We force SIGKILL
#   before start so a fresh process binds cleanly.
#
# This script does:
#   1. cd cli && node scripts/build-cli.js   (Next.js build + bundle copy)
#   2. copy cli/app/.next-cli-build/static → <service>/.next-cli-build/static
#   3. copy cli/app/public                 → <service>/public
#   4. SIGKILL any old 9router process (incl. stragglers via pkill -f)
#   5. systemctl --user restart 9router.service (fresh start)
#   6. wait for service to be reachable + smoke test + classifier replay
#
# Idempotent. Re-run safely.

set -euo pipefail

REPO_ROOT="${REPO_ROOT:-/home/ron/Documents/Projects/9router}"
SERVICE_ROOT="${SERVICE_ROOT:-$REPO_ROOT/.next-cli-build/standalone/9router}"
CLI_APP_DIR="${CLI_APP_DIR:-$REPO_ROOT/cli/app}"
SERVICE_STATIC_DIR="${SERVICE_STATIC_DIR:-$SERVICE_ROOT/.next-cli-build/static}"
CLI_STATIC_DIR="${CLI_STATIC_DIR:-$CLI_APP_DIR/.next-cli-build/static}"
SERVICE_PUBLIC_DIR="${SERVICE_PUBLIC_DIR:-$SERVICE_ROOT/public}"
CLI_PUBLIC_DIR="${CLI_PUBLIC_DIR:-$CLI_APP_DIR/public}"
PORT="${PORT:-20128}"
BASE_URL="${BASE_URL:-http://127.0.0.1:$PORT}"

log() { printf '\033[1;34m[run.sh]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[run.sh]\033[0m %s\n' "$*" >&2; }
err() { printf '\033[1;31m[run.sh]\033[0m %s\n' "$*" >&2; }

# Sanity
[ -d "$REPO_ROOT" ] || { err "REPO_ROOT not found: $REPO_ROOT"; exit 1; }
[ -d "$SERVICE_ROOT" ] || { err "SERVICE_ROOT not found: $SERVICE_ROOT"; exit 1; }
[ -d "$CLI_APP_DIR" ] || { err "CLI_APP_DIR not found: $CLI_APP_DIR"; exit 1; }
command -v systemctl >/dev/null 2>&1 || { err "systemctl not found"; exit 1; }
command -v node >/dev/null 2>&1 || { err "node not found"; exit 1; }

log "1/6 Building CLI bundle (Next.js + cli scripts)..."
(
  cd "$REPO_ROOT/cli"
  if [ ! -d node_modules ]; then
    log "  installing cli devDependencies (esbuild etc.)"
    npm install
  fi
  node scripts/build-cli.js
)

log "2/6 Syncing static assets into live service bundle..."
if [ -d "$CLI_STATIC_DIR" ]; then
  mkdir -p "$SERVICE_STATIC_DIR"
  cp -r "$CLI_STATIC_DIR"/. "$SERVICE_STATIC_DIR"/
  log "  copied: $CLI_STATIC_DIR → $SERVICE_STATIC_DIR"
else
  warn "  no static dir at $CLI_STATIC_DIR (build may have failed)"
  exit 1
fi

log "3/6 Syncing public folder (favicon, provider icons, i18n, sw.js)..."
if [ -d "$CLI_PUBLIC_DIR" ]; then
  mkdir -p "$SERVICE_PUBLIC_DIR"
  cp -r "$CLI_PUBLIC_DIR"/. "$SERVICE_PUBLIC_DIR"/
  COUNT=$(find "$SERVICE_PUBLIC_DIR" -type f | wc -l)
  log "  copied: $CLI_PUBLIC_DIR → $SERVICE_PUBLIC_DIR ($COUNT files)"
else
  warn "  no public dir at $CLI_PUBLIC_DIR (continuing without — icons may 404)"
fi

log "4/6 Killing any lingering 9router processes (SIGKILL)..."
# systemctl kill sends SIGKILL to the service's cgroup; this catches the
# main `node server.js` plus any helpers still registered with systemd.
systemctl --user kill --signal=SIGKILL 9router.service 2>/dev/null || true
# pkill fallback for stragglers not visible to systemd (e.g., the
# `next-server` workers that survived a hot reload). Scoped via `-f` to
# the resolved service path so unrelated node processes are NOT killed.
STRAGGLER_PATTERN="$(realpath "$SERVICE_ROOT" 2>/dev/null || echo "$SERVICE_ROOT")"
if [ -n "$STRAGGLER_PATTERN" ]; then
  pkill -KILL -f "$STRAGGLER_PATTERN" 2>/dev/null || true
fi
# Wait up to 5s for port 20128 to actually free up before we start the
# next instance — otherwise the new server.js can race to bind and fail.
for i in $(seq 1 5); do
  if ! ss -tlnp 2>/dev/null | grep -qE ":${PORT}\b.*users:"; then
    break
  fi
  sleep 1
done

log "5/6 Starting fresh 9router user service..."
systemctl --user start 9router.service

log "6/6 Waiting for service on $BASE_URL (max 30s)..."
ready=0
for i in $(seq 1 30); do
  if curl -sf -o /dev/null "$BASE_URL/api/settings" 2>/dev/null; then
    ready=1
    log "  ready in ${i}s"
    break
  fi
  sleep 1
done
[ "$ready" = "1" ] || { err "service did not become reachable in 30s"; systemctl --user status 9router.service --no-pager | head -20; exit 1; }

log "Smoke tests..."
set +e
SET=$(curl -sf "$BASE_URL/api/settings")
echo "  GET /api/settings → claudeClassifierCompat=$(echo "$SET" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("claudeClassifierCompat","?"))')"

CHUNK=$(curl -sI "$BASE_URL/_next/static/chunks/" 2>/dev/null | head -1)
echo "  HEAD /_next/static/chunks/ → ${CHUNK:-<unreachable>}"

FAVICON=$(curl -sI "$BASE_URL/favicon.svg" 2>/dev/null | head -1)
echo "  HEAD /favicon.svg → ${FAVICON:-<unreachable>}"

PROV=$(curl -sI "$BASE_URL/providers/claude.png" 2>/dev/null | head -1)
echo "  HEAD /providers/claude.png → ${PROV:-<unreachable>}"

echo
log "  quick classifier replay (always):"
python3 - <<PY
import json, urllib.request
from pathlib import Path
body = json.loads(Path("/tmp/exact-classifier-body.json").read_text()) if Path("/tmp/exact-classifier-body.json").exists() else None
if not body:
    print("    (no /tmp/exact-classifier-body.json — skipping replay)")
else:
    try:
        req = urllib.request.Request("$BASE_URL/api/settings", data=json.dumps({"claudeClassifierCompat":"always"}).encode(), headers={"Content-Type":"application/json"}, method="PATCH")
        urllib.request.urlopen(req).read()
        req = urllib.request.Request("$BASE_URL/v1/messages", data=json.dumps(body).encode(), headers={"Content-Type":"application/json","anthropic-version":"2023-06-01","Accept":"application/json"}, method="POST")
        text = urllib.request.urlopen(req, timeout=120).read().decode("utf-8","ignore")
        obj = json.loads(text)
        types = [b.get("type") for b in obj.get("content", [])]
        print("    response.type =", obj.get("type"))
        print("    content types =", types)
        print("    thinking blocks =", sum(1 for t in types if t == "thinking"))
    except Exception as e:
        print("    replay error:", e)
PY
set -e

log "Done."
echo
log "Next steps:"
log "  - open $BASE_URL/dashboard/token-saver in a browser to see the new control"
log "  - cli menu: 9router → Settings → 'Claude Classifier Compat: cycle'"
