#!/usr/bin/env bash
# 9router CLI build + deploy automation (crash-consistent / SIGKILL-survivable)
#
# SIGKILL (signal 9) cannot be trapped by any process. Instead of trying to
# "catch" it, this script is structured so an abrupt kill never leaves the live
# service half-swapped:
#
#   - All slow work (build, bundle copy, aux files) happens in a STAGING area.
#     The live `app/` directory is never touched until everything is ready.
#   - The live swap is two same-filesystem renames (near-atomic), not a long cp.
#   - The critical section (swap + pm2 restart + verify + rollback) runs DETACHED
#     via setsid, in its own session/process group, so a SIGKILL aimed at this
#     script's process group (e.g. an exec wrapper being killed) does not sever
#     the swap mid-flight.
#   - Every phase is journaled. `--recover` inspects the journal + filesystem and
#     repairs any state left by a kill in the micro-gap between renames.
#
# Usage:
#   ./scripts/deploy-9router.sh [--skip-smoke] [--skip-build]
#   ./scripts/deploy-9router.sh --status
#   ./scripts/deploy-9router.sh --recover
#
# Internal (invoked detached, do not call directly):
#   ./scripts/deploy-9router.sh --phase-swap <ts> <stage_dir>

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI_DIR="${REPO_ROOT}/cli"
CLI_APP_DIR="${CLI_DIR}/app"
SMOKE_HOME="${CLI_DIR}/.smoke-home"
GLOBAL_CLI_DIR="${HOME}/.npm-global/lib/node_modules/9router"
SMOKE_PORT=20129
LIVE_PORT=20128
LATEST_PTR="${GLOBAL_CLI_DIR}/.deploy-latest"

log()  { printf '\033[36m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[deploy]\033[0m %s\n' "$*"; }
err()  { printf '\033[31m[deploy]\033[0m %s\n' "$*" >&2; }
die()  { err "$*"; exit 1; }

journal_file_for() { printf '%s/.deploy-journal.%s' "$GLOBAL_CLI_DIR" "$1"; }
jstate() { printf '%s STATE %s\n' "$(date +%Y-%m-%dT%H:%M:%S%z)" "$1" >> "$JOURNAL"; }
jkv()    { printf '%s KV %s %s\n' "$(date +%Y-%m-%dT%H:%M:%S%z)" "$1" "$2" >> "$JOURNAL"; }
last_state() { awk '$2=="STATE"{s=$3} END{print s}' "$1" 2>/dev/null; }
get_kv() { awk -v k="$2" '$2=="KV"&&$3==k{v=$4} END{print v}' "$1" 2>/dev/null; }

wait_live_healthy() {
  local tries="${1:-20}" i body
  for ((i=1;i<=tries;i++)); do
    body="$(curl -s -m 5 "http://localhost:${LIVE_PORT}/api/health" 2>/dev/null || true)"
    [[ "$body" == '{"ok":true}' ]] && return 0
    sleep 1.5
  done
  return 1
}

# ---------------------------------------------------------------------------
# Critical section: runs detached (setsid) so SIGKILL to the caller's process
# group cannot interrupt it. Idempotent enough for --recover to re-enter.
# ---------------------------------------------------------------------------
phase_swap() {
  local ts="$1" stage_dir="$2"
  local live="${GLOBAL_CLI_DIR}/app"
  local backup_dir="${GLOBAL_CLI_DIR}/app.bak.${ts}"
  JOURNAL="$(journal_file_for "$ts")"
  local swap_log="/tmp/9router-deploy-swap-${ts}.log"

  jkv backup "$backup_dir"

  # 1. live -> backup (skip if already done by a prior, killed attempt)
  if [[ -d "$live" && ! -d "$backup_dir" ]]; then
    mv "$live" "$backup_dir"
  fi
  jstate BACKED_UP

  # 2. staging -> live
  if [[ ! -e "$live" && -d "$stage_dir" ]]; then
    mv "$stage_dir" "$live"
  fi
  jstate SWAPPED

  if [[ ! -f "${live}/server.js" ]]; then
    jstate SWAP_BROKEN
    # try to restore backup
    if [[ -d "$backup_dir" ]]; then
      [[ -e "$live" ]] && mv "$live" "${GLOBAL_CLI_DIR}/app.failed.${ts}"
      mv "$backup_dir" "$live"
      pm2 restart 9router --update-env >>"$swap_log" 2>&1 || true
    fi
    jstate ROLLED_BACK
    return 1
  fi

  # 3. restart
  pm2 restart 9router --update-env >>"$swap_log" 2>&1 || true
  jstate RESTARTED

  # 4. verify
  if wait_live_healthy 25; then
    jstate DONE
    return 0
  fi

  # 5. rollback
  jstate VERIFY_FAILED
  if [[ -d "$backup_dir" && -f "${backup_dir}/server.js" ]]; then
    [[ -e "$live" ]] && mv "$live" "${GLOBAL_CLI_DIR}/app.failed.${ts}"
    mv "$backup_dir" "$live"
    pm2 restart 9router --update-env >>"$swap_log" 2>&1 || true
    wait_live_healthy 25 || true
  fi
  jstate ROLLED_BACK
  return 1
}

cmd_status() {
  [[ -f "$LATEST_PTR" ]] || die "No deploy journal found."
  local ts; ts="$(cat "$LATEST_PTR")"
  local jf; jf="$(journal_file_for "$ts")"
  log "Latest deploy: ${ts}"
  log "  Journal:  ${jf}"
  log "  State:    $(last_state "$jf")"
  log "  Stage:    $(get_kv "$jf" stage)"
  log "  Backup:   $(get_kv "$jf" backup)"
  local body; body="$(curl -s -m 5 "http://localhost:${LIVE_PORT}/api/health" 2>/dev/null || echo unreachable)"
  log "  Live:     ${body}"
}

cmd_recover() {
  [[ -f "$LATEST_PTR" ]] || die "No deploy journal found; nothing to recover."
  local ts; ts="$(cat "$LATEST_PTR")"
  JOURNAL="$(journal_file_for "$ts")"
  local state; state="$(last_state "$JOURNAL")"
  local live="${GLOBAL_CLI_DIR}/app"
  local backup_dir; backup_dir="$(get_kv "$JOURNAL" backup)"
  local stage_dir;  stage_dir="$(get_kv "$JOURNAL" stage)"
  [[ -n "$backup_dir" ]] || backup_dir="${GLOBAL_CLI_DIR}/app.bak.${ts}"

  log "Recovering deploy ${ts} (last state: ${state:-none})"

  case "$state" in
    DONE)
      if wait_live_healthy 5; then log "Already healthy; nothing to do."; return 0; fi
      warn "State DONE but live unhealthy; restarting."
      pm2 restart 9router --update-env 2>&1 | tail -3 || true
      ;;
    RESTARTED)
      if [[ -f "${live}/server.js" ]] && wait_live_healthy 5; then
        log "Live is already healthy after restart; marking deploy DONE."
        jstate DONE
        return 0
      fi
      warn "State RESTARTED but live is not healthy; re-running critical section."
      jstate RECOVER_RESUME
      phase_swap "$ts" "$stage_dir"
      ;;
    ROLLED_BACK)
      log "Last deploy rolled back; ensuring live healthy."
      ;;
    STAGED|BACKED_UP|SWAPPED|VERIFY_FAILED|SWAP_BROKEN|"")
      warn "Incomplete swap detected; re-running critical section."
      jstate RECOVER_RESUME
      phase_swap "$ts" "$stage_dir"
      ;;
    *)
      warn "Unknown state '${state}'; ensuring a healthy live app."
      ;;
  esac

  # Final consistency guarantee: live must exist and be healthy.
  if [[ ! -f "${live}/server.js" && -f "${backup_dir}/server.js" ]]; then
    warn "Live app missing; restoring backup."
    mv "$backup_dir" "$live"
    pm2 restart 9router --update-env 2>&1 | tail -3 || true
  fi
  if wait_live_healthy 25; then
    log "✓ Recovered: live healthy ($(curl -s -m5 http://localhost:${LIVE_PORT}/api/version))"
    return 0
  fi
  die "Recovery could not bring live to healthy state. Inspect ${JOURNAL}"
}

cleanup_smoke() {
  if [[ -f "${SMOKE_HOME}/server.pid" ]]; then
    local pid; pid="$(cat "${SMOKE_HOME}/server.pid" 2>/dev/null || true)"
    [[ -n "$pid" ]] && kill -9 "$pid" 2>/dev/null || true
  fi
  command -v fuser >/dev/null 2>&1 && fuser -k "${SMOKE_PORT}/tcp" 2>/dev/null || true
}

check_url() {
  local url="$1" expect="$2" name="$3" code
  code="$(curl -s -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || echo 000)"
  if [[ "$code" =~ ^${expect}$ ]]; then log "  ✓ ${name}: ${code}"; return 0; fi
  err "  ✗ ${name}: ${code} (expected ${expect})"; return 1
}

# ---------------------------------------------------------------------------
# Argument dispatch
# ---------------------------------------------------------------------------
SKIP_SMOKE=false
SKIP_BUILD=false
case "${1:-}" in
  --phase-swap) shift; phase_swap "$@"; exit $? ;;
  --status)     cmd_status; exit $? ;;
  --recover)    cmd_recover; exit $? ;;
  --help|-h)    sed -n '2,30p' "$0"; exit 0 ;;
esac
for arg in "$@"; do
  case "$arg" in
    --skip-smoke) SKIP_SMOKE=true ;;
    --skip-build) SKIP_BUILD=true ;;
    *) die "Unknown arg: $arg (see --help)" ;;
  esac
done

trap cleanup_smoke EXIT

# Step 1: Build (output dir only; live untouched)
if [[ "$SKIP_BUILD" == "false" ]]; then
  log "Step 1: Build CLI bundle"
  cd "$REPO_ROOT"
  rm -rf "${CLI_APP_DIR}"
  npm run build --prefix cli > /tmp/9router-deploy-build.log 2>&1 \
    || die "Build failed. Log: /tmp/9router-deploy-build.log"
  [[ -f "${CLI_APP_DIR}/server.js" ]] || die "Build did not produce ${CLI_APP_DIR}/server.js"
  log "  ✓ Bundle built: $(du -sh "${CLI_APP_DIR}" | cut -f1)"
else
  log "Step 1: skipped (--skip-build)"
fi

# Step 2: Smoke test on isolated :20129 (live untouched)
if [[ "$SKIP_SMOKE" == "false" ]]; then
  log "Step 2: Smoke test on :${SMOKE_PORT}"
  cleanup_smoke
  mkdir -p "${SMOKE_HOME}"
  rm -f "${SMOKE_HOME}/server.log" "${SMOKE_HOME}/server.pid"
  ( cd "${CLI_APP_DIR}" \
      && NODE_PATH="${CLI_APP_DIR}/node_modules" PORT="${SMOKE_PORT}" \
         HOSTNAME=127.0.0.1 HOME="${SMOKE_HOME}" \
         node server.js > "${SMOKE_HOME}/server.log" 2>&1 &
    echo $! > "${SMOKE_HOME}/server.pid" )
  sleep 12
  if ! kill -0 "$(cat "${SMOKE_HOME}/server.pid")" 2>/dev/null; then
    tail -40 "${SMOKE_HOME}/server.log" >&2
    die "Smoke test failed: server crashed"
  fi
  failed=0
  check_url "http://localhost:${SMOKE_PORT}/api/health"  "200" "health"  || failed=1
  check_url "http://localhost:${SMOKE_PORT}/api/version" "200" "version" || failed=1
  check_url "http://localhost:${SMOKE_PORT}/dashboard"   "307" "dashboard" || failed=1
  cleanup_smoke
  [[ "$failed" -eq 0 ]] || die "Smoke test failed. Log: ${SMOKE_HOME}/server.log"
  log "  ✓ Smoke passed"
else
  log "Step 2: skipped (--skip-smoke)"
fi

# Step 3: Stage full bundle next to live (still no live mutation)
ts="$(date +%Y%m%d-%H%M%S)"
stage_dir="${GLOBAL_CLI_DIR}/app.staging.${ts}"
JOURNAL="$(journal_file_for "$ts")"
log "Step 3: Stage bundle -> app.staging.${ts}"
rm -rf "$stage_dir"
cp -a "${CLI_APP_DIR}" "$stage_dir" || die "Staging copy failed"
[[ -f "${stage_dir}/server.js" ]] || die "Staging copy incomplete (no server.js)"
# Stamp source for archaeology
( git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo unknown ) > "${stage_dir}/.openclaw-source-commit"
: > "$JOURNAL"
jkv stage "$stage_dir"
jkv repo  "$REPO_ROOT"
jstate STAGED
echo "$ts" > "$LATEST_PTR"
log "  ✓ Staged: $(du -sh "$stage_dir" | cut -f1)"

# Update auxiliary CLI files in place (not used by the running pm2 process,
# safe to overwrite before the critical swap).
for f in cli.js package.json; do
  [[ -f "${CLI_DIR}/${f}" ]] || continue
  cp "${CLI_DIR}/${f}" "${GLOBAL_CLI_DIR}/.${f}.new.${ts}" \
    && mv "${GLOBAL_CLI_DIR}/.${f}.new.${ts}" "${GLOBAL_CLI_DIR}/${f}"
done

# Step 4: Critical swap, DETACHED so SIGKILL to our process group can't sever it
log "Step 4: Swap + restart (detached, SIGKILL-survivable)"
swap_log="/tmp/9router-deploy-swap-${ts}.log"
setsid bash "$REPO_ROOT/scripts/deploy-9router.sh" --phase-swap "$ts" "$stage_dir" \
  </dev/null >>"$swap_log" 2>&1 &
swap_pid=$!
disown "$swap_pid" 2>/dev/null || true
log "  → detached swap pid=${swap_pid}, log=${swap_log}"

# Step 5: Observe the detached swap (it survives even if WE get killed here)
log "Step 5: Awaiting swap outcome (live :${LIVE_PORT})"
deadline=$(( SECONDS + 90 ))
final=""
while (( SECONDS < deadline )); do
  st="$(last_state "$JOURNAL")"
  case "$st" in
    DONE)        final="DONE"; break ;;
    ROLLED_BACK) final="ROLLED_BACK"; break ;;
    RESTARTED)
      # The detached phase may be killed by an external supervisor after pm2
      # restart but before it can append DONE. If live is already healthy, the
      # deploy is complete; close the journal from the observer process.
      if [[ -f "${GLOBAL_CLI_DIR}/app/server.js" ]] && wait_live_healthy 1; then
        jstate DONE
        final="DONE"
        break
      fi
      ;;
  esac
  sleep 2
done

case "$final" in
  DONE)
    log "✓ Deploy successful (backup: $(get_kv "$JOURNAL" backup))"
    log "  Live version: $(curl -s -m5 http://localhost:${LIVE_PORT}/api/version)"
    exit 0 ;;
  ROLLED_BACK)
    err "Deploy verify failed; rolled back to previous bundle."
    err "  Swap log: ${swap_log}"
    exit 1 ;;
  *)
    warn "Swap still running detached after 90s (it is NOT tied to this process)."
    warn "  Check:   ./scripts/deploy-9router.sh --status"
    warn "  Repair:  ./scripts/deploy-9router.sh --recover"
    warn "  Log:     ${swap_log}"
    exit 2 ;;
esac
