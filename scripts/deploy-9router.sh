#!/usr/bin/env bash
# 9router CLI build + deploy automation
#
# Steps:
#   1. Build CLI bundle (npm run build --prefix cli)
#   2. Smoke test bundle on isolated port :20129 with correct NODE_PATH
#   3. Copy bundle to global CLI install (~/.npm-global/lib/node_modules/9router/)
#   4. Restart PM2 9router process
#   5. Smoke test live :20128
#   6. Rollback on any failure
#
# Usage: ./scripts/deploy-9router.sh [--skip-smoke|--skip-build]

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI_DIR="${REPO_ROOT}/cli"
CLI_APP_DIR="${CLI_DIR}/app"
SMOKE_HOME="${CLI_DIR}/.smoke-home"
GLOBAL_CLI_DIR="${HOME}/.npm-global/lib/node_modules/9router"
SMOKE_PORT=20129
LIVE_PORT=20128

SKIP_SMOKE=false
SKIP_BUILD=false
for arg in "$@"; do
  case "$arg" in
    --skip-smoke) SKIP_SMOKE=true ;;
    --skip-build) SKIP_BUILD=true ;;
    --help|-h) sed -n '2,15p' "$0"; exit 0 ;;
  esac
done

log()  { printf '\033[36m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[deploy]\033[0m %s\n' "$*"; }
err()  { printf '\033[31m[deploy]\033[0m %s\n' "$*" >&2; }
die()  { err "$*"; exit 1; }

cleanup_smoke() {
  if [[ -f "${SMOKE_HOME}/server.pid" ]]; then
    local pid
    pid="$(cat "${SMOKE_HOME}/server.pid" 2>/dev/null || true)"
    [[ -n "$pid" ]] && kill -9 "$pid" 2>/dev/null || true
  fi
  fuser -k "${SMOKE_PORT}/tcp" 2>/dev/null || true
}
trap cleanup_smoke EXIT

check_url() {
  local url="$1" expect="$2" name="$3"
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || echo 000)"
  if [[ "$code" =~ ^${expect}$ ]]; then
    log "  ✓ ${name}: ${code}"
    return 0
  else
    err "  ✗ ${name}: ${code} (expected ${expect})"
    return 1
  fi
}

# Step 1: Build
if [[ "$SKIP_BUILD" == "false" ]]; then
  log "Step 1: Build CLI bundle"
  cd "$REPO_ROOT"
  rm -rf "${CLI_APP_DIR}"
  npm run build --prefix cli > /tmp/9router-deploy-build.log 2>&1 \
    || die "Build failed. Log: /tmp/9router-deploy-build.log"
  [[ -f "${CLI_APP_DIR}/server.js" ]] \
    || die "Build did not produce ${CLI_APP_DIR}/server.js"
  log "  ✓ Bundle built: $(du -sh "${CLI_APP_DIR}" | cut -f1)"
else
  log "Step 1: skipped (--skip-build)"
fi

# Step 2: Smoke test on :20129
if [[ "$SKIP_SMOKE" == "false" ]]; then
  log "Step 2: Smoke test on :${SMOKE_PORT}"
  cleanup_smoke
  mkdir -p "${SMOKE_HOME}"
  rm -f "${SMOKE_HOME}/server.log" "${SMOKE_HOME}/server.pid"

  (cd "${CLI_APP_DIR}" \
    && NODE_PATH="${CLI_APP_DIR}/node_modules" \
       PORT="${SMOKE_PORT}" \
       HOSTNAME=0.0.0.0 \
       HOME="${SMOKE_HOME}" \
       node server.js > "${SMOKE_HOME}/server.log" 2>&1 \
       & echo $! > "${SMOKE_HOME}/server.pid"
  )
  sleep 12

  smoke_pid="$(cat "${SMOKE_HOME}/server.pid")"
  if ! kill -0 "$smoke_pid" 2>/dev/null; then
    err "Smoke server died. Log:"
    tail -40 "${SMOKE_HOME}/server.log" >&2
    die "Smoke test failed: server crashed"
  fi

  failed=0
  check_url "http://localhost:${SMOKE_PORT}/api/health"  "200" "health"  || failed=1
  check_url "http://localhost:${SMOKE_PORT}/api/init"    "200" "init"    || failed=1
  check_url "http://localhost:${SMOKE_PORT}/api/version" "200" "version" || failed=1
  check_url "http://localhost:${SMOKE_PORT}/login"       "200" "login"   || failed=1
  check_url "http://localhost:${SMOKE_PORT}/dashboard"   "307" "dashboard" || failed=1

  cleanup_smoke
  [[ "$failed" -eq 0 ]] || die "Smoke test failed. Log: ${SMOKE_HOME}/server.log"
  log "  ✓ Smoke passed"
else
  log "Step 2: skipped (--skip-smoke)"
fi

# Step 3: Backup + deploy to global
log "Step 3: Deploy to global CLI"
ts="$(date +%Y%m%d-%H%M%S)"
backup_dir="${GLOBAL_CLI_DIR}/app.bak.${ts}"
if [[ -d "${GLOBAL_CLI_DIR}/app" ]]; then
  log "  → backup: app.bak.${ts}"
  mv "${GLOBAL_CLI_DIR}/app" "${backup_dir}"
fi

trap 'on_deploy_fail' ERR
on_deploy_fail() {
  err "Deploy failed. Rolling back..."
  rm -rf "${GLOBAL_CLI_DIR}/app" 2>/dev/null || true
  [[ -d "${backup_dir}" ]] && mv "${backup_dir}" "${GLOBAL_CLI_DIR}/app"
  pm2 restart 9router 2>&1 | tail -5 || true
  exit 1
}

cp -r "${CLI_APP_DIR}"  "${GLOBAL_CLI_DIR}/app"
cp    "${CLI_DIR}/cli.js"        "${GLOBAL_CLI_DIR}/cli.js"
cp    "${CLI_DIR}/package.json"  "${GLOBAL_CLI_DIR}/package.json"
rm -rf "${GLOBAL_CLI_DIR}/hooks" "${GLOBAL_CLI_DIR}/src"
cp -r "${CLI_DIR}/hooks" "${GLOBAL_CLI_DIR}/hooks"
cp -r "${CLI_DIR}/src"   "${GLOBAL_CLI_DIR}/src"
log "  ✓ Files deployed"

# Step 4: PM2 restart
log "Step 4: PM2 restart"
pm2 restart 9router 2>&1 | tail -3
sleep 12

# Step 5: Live smoke
log "Step 5: Smoke test live :${LIVE_PORT}"
failed=0
check_url "http://localhost:${LIVE_PORT}/api/health"  "200" "health"  || failed=1
check_url "http://localhost:${LIVE_PORT}/api/init"    "200" "init"    || failed=1
check_url "http://localhost:${LIVE_PORT}/api/version" "200" "version" || failed=1
check_url "http://localhost:${LIVE_PORT}/login"       "200" "login"   || failed=1
check_url "http://localhost:${LIVE_PORT}/dashboard"   "307" "dashboard" || failed=1

if [[ "$failed" -ne 0 ]]; then
  on_deploy_fail
fi

trap - ERR
log "✓ Deploy successful (backup: ${backup_dir})"
log "  Live version: $(curl -s http://localhost:${LIVE_PORT}/api/version)"
