#!/usr/bin/env bash
# update-from-origin.sh — pull + install + build + restart + verify for secondary
# router9 machines (DGX, MacBook, etc). NOT for the primary integration laptop
# (that one runs the guarded update-9router Hermes skill instead).
#
# Usage:
#   ./update-from-origin.sh              # pull fix/azure-custom-endpoint (default)
#   ./update-from-origin.sh master       # pull a specific branch
#   ./update-from-origin.sh --no-restart # update working tree only
#
# Safe by design: refuses to run with uncommitted changes (stash them first),
# never touches upstream remote, never force-pushes, never edits azure.js.

set -euo pipefail

BRANCH="${1:-fix/azure-custom-endpoint}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_UNIT="router9.service"
PORT="${ROUTER9_PORT:-20128}"
NO_RESTART=false
[[ "${1:-}" == "--no-restart" ]] && { NO_RESTART=true; BRANCH="fix/azure-custom-endpoint"; }

cd "$REPO_DIR"

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m ✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m ! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m ✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ---------- 0. Preflight ----------
say "Preflight (branch: $BRANCH)"

git fetch origin --prune --quiet || die "git fetch origin failed — check network/credentials"

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$CURRENT_BRANCH" != "$BRANCH" ]]; then
  warn "On branch '$CURRENT_BRANCH', switching to '$BRANCH'"
  git checkout "$BRANCH" || die "cannot checkout $BRANCH"
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  die "Uncommitted changes detected. Stash or commit them first:
     git stash push -m \"before update \$(date +%F-%H%M)\"
   then re-run this script."
fi

OLD_VER="$(grep -m1 '"version"' package.json | sed 's/[^0-9.]//g')"
OLD_HEAD="$(git rev-parse --short=8 HEAD)"
LOCAL_AHEAD="$(git rev-list --count "origin/$BRANCH..HEAD" 2>/dev/null || echo 0)"
if [[ "$LOCAL_AHEAD" != "0" ]]; then
  die "Local branch is ahead of origin by $LOCAL_AHEAD commit(s). This machine must
     only follow origin — investigate why it diverged before updating."
fi

BEHIND="$(git rev-list --count "HEAD..origin/$BRANCH")"
if [[ "$BEHIND" == "0" ]]; then
  ok "Already up to date ($OLD_VER @ $OLD_HEAD). Nothing to do."
  exit 0
fi
ok "Origin has $BEHIND new commit(s). Current: v$OLD_VER @ $OLD_HEAD"

# ---------- 1. Backup local DB ----------
say "Backing up local SQLite DB"
DB="${DATA_DIR:-$HOME/.9router-custom}/db/data.sqlite"
if [[ -f "$DB" ]]; then
  BK_DIR="$HOME/.9router-custom/db/backups/pre-pull-$(date +%Y%m%d_%H%M%S)"
  mkdir -p "$BK_DIR"
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "$DB" ".backup '$BK_DIR/data.sqlite.bak'" && ok "sqlite3 backup → $BK_DIR"
  else
    cp -a "${DB}"* "$BK_DIR/" && ok "cp backup → $BK_DIR"
  fi
else
  warn "No DB at $DB — skipping backup (fresh machine?)"
fi

# ---------- 2. Pull ----------
say "Pulling origin/$BRANCH"
git merge --ff-only "origin/$BRANCH" || die "Non-fast-forward — local history diverged
   from origin. Do NOT force; investigate (this machine should never merge upstream)."
NEW_VER="$(grep -m1 '"version"' package.json | sed 's/[^0-9.]//g')"
NEW_HEAD="$(git rev-parse --short=8 HEAD)"
ok "Pulled: v$OLD_VER → v$NEW_VER ($OLD_HEAD → $NEW_HEAD)"

# ---------- 3. Install deps ----------
say "Installing dependencies"
npm install --no-audit --no-fund | tail -1
[[ -d tests ]] && (cd tests && npm install --no-audit --no-fund >/dev/null 2>&1 \
  && ok "tests deps OK" || warn "tests npm install failed (non-fatal)")

# ---------- 4. Smoke tests (if vitest available) ----------
if [[ -x tests/node_modules/.bin/vitest ]]; then
  say "Running smoke tests"
  (cd tests && npx vitest run unit/azure-executor.test.js unit/tunnel-healthcheck.test.js \
    2>&1 | grep -E "Tests.*passed" || true)
  warn "Reminder: 1 known-baseline failure in azure-executor is OK (reasoning_effort 'none' test)"
fi

# ---------- 5. Build ----------
say "Building (this can take a few minutes)"
npm run build > /tmp/router9-build.log 2>&1 || die "Build failed — see /tmp/router9-build.log
   The service is still running the OLD build, nothing broke."
ok "Build OK"
BUILD_TS="$(stat -c %Y .next/BUILD_ID 2>/dev/null || echo 0)"

# ---------- 6. Restart ----------
if $NO_RESTART; then
  warn "--no-restart: skipping service restart. Restart manually to apply."
  exit 0
fi

say "Restarting service"
if systemctl --user cat "$SERVICE_UNIT" >/dev/null 2>&1; then
  systemctl --user restart "$SERVICE_UNIT"
  RESTART_CMD="systemctl --user restart $SERVICE_UNIT"
elif systemctl cat "$SERVICE_UNIT" >/dev/null 2>&1; then
  sudo systemctl restart "$SERVICE_UNIT"
  RESTART_CMD="sudo systemctl restart $SERVICE_UNIT"
else
  die "No systemd unit '$SERVICE_UNIT' found. Restart router9 manually, then re-run
     with --no-restart for verification only."
fi
sleep 8
ACTIVE="$(systemctl --user is-active "$SERVICE_UNIT" 2>/dev/null || systemctl is-active "$SERVICE_UNIT" 2>/dev/null || echo unknown)"
[[ "$ACTIVE" == "active" ]] || die "Service not active after restart ($ACTIVE). Check:
   journalctl --user -u $SERVICE_UNIT -n 50"

# ---------- 7. Verify ----------
say "Verifying"
HEALTH="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:$PORT/api/health" || echo 000)"
[[ "$HEALTH" == "200" ]] || die "Health check failed ($HEALTH). Roll back with:
   git checkout backup branch or git reset --hard $OLD_HEAD, rebuild, restart."

VERSION_JSON="$(curl -s --max-time 10 "http://127.0.0.1:$PORT/api/version" || echo '{}')"
CURRENT_VER="$(python3 -c "import json,sys; print(json.load(sys.stdin).get('currentVersion','?'))" <<< "$VERSION_JSON" 2>/dev/null || echo '?')"
HAS_UPDATE="$(python3 -c "import json,sys; print(json.load(sys.stdin).get('hasUpdate','?'))" <<< "$VERSION_JSON" 2>/dev/null || echo '?')"

PID_START="$(systemctl --user show "$SERVICE_UNIT" -p ActiveEnterTimestamp --value 2>/dev/null \
  || systemctl show "$SERVICE_UNIT" -p ActiveEnterTimestamp --value 2>/dev/null || echo '?')"

ok "Health 200 | service active (since $PID_START)"
ok "Live version: $CURRENT_VER (hasUpdate: $HAS_UPDATE)"

if [[ "$CURRENT_VER" != "$NEW_VER" ]]; then
  die "Running process reports v$CURRENT_VER but repo is v$NEW_VER.
     Likely restarted BEFORE build finished. Re-run: $RESTART_CMD"
fi
if [[ "$HAS_UPDATE" == "True" ]]; then
  warn "Dashboard still flags an update available — upstream may have published newer again."
fi

# ---------- 8. Tunnel note ----------
say "Tunnel"
if pgrep -f "cloudflared tunnel" >/dev/null 2>&1; then
  ok "cloudflared is running (tunnel URL may rotate; check the dashboard)"
else
  warn "No cloudflared process. On secondary machines the tunnel may be disabled —
   if you use it here, enable from the dashboard or see the update-9router skill."
fi

printf '\n\033[1;32m═══ Done: v%s → v%s (%s) ═══\033[0m\n' "$OLD_VER" "$NEW_VER" "$NEW_HEAD"
