#!/usr/bin/env bash
# Verify the REAL production topology: launcher (cli/cli.js) -> standalone server.
#
# Why this exists: the launcher used to SIGKILL the server on shutdown, which
# silently discarded the drain of in-flight usage writes, and it sent the
# server's stdout to /dev/null, which made routing incidents undiagnosable.
# Neither is covered by the vitest suite (the cli/ package has no test runner),
# so this script is the only automated proof that both stay fixed.
#
# Safe by construction: temporary HOME and DATA_DIR, an alternative port bound to
# 127.0.0.1, and nothing is ever sent to the real service or ~/.9router.
#
# Usage:  npm run build && bash scripts/verify-shutdown-topology.sh
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-20998}"
NODE_BIN="${NODE_BIN:-$(command -v node)}"

if [ ! -f "$REPO/.next/standalone/custom-server.js" ]; then
  echo "FAIL: no standalone build. Run 'npm run build' first." >&2
  exit 2
fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/9r-topology-XXXXXX")"
STAGE="$TMP/stage"
mkdir -p "$STAGE"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

# cli.js and package.json are COPIED: __dirname resolves through a symlink to
# its real path, so a linked cli.js would load cli/app (a stale build) instead
# of the standalone we just built.
cp "$REPO/cli/cli.js" "$STAGE/cli.js"
cp "$REPO/cli/package.json" "$STAGE/package.json"
for entry in src hooks node_modules scripts; do
  [ -e "$REPO/cli/$entry" ] && ln -s "$REPO/cli/$entry" "$STAGE/$entry"
done
ln -s "$REPO/.next/standalone" "$STAGE/app"

env -i PATH="$PATH" HOME="$TMP" DATA_DIR="$TMP/data" \
    JWT_SECRET=topology-check INITIAL_PASSWORD=topology-check \
    "$NODE_BIN" "$STAGE/cli.js" --no-browser --skip-update \
      --port "$PORT" --host 127.0.0.1 > "$TMP/launcher.log" 2>&1 &
LAUNCHER=$!

fail() { echo "FAIL: $1" >&2; kill -9 $LAUNCHER 2>/dev/null; exit 1; }

curl -s -o /dev/null --retry 60 --retry-delay 1 --retry-connrefused \
     "http://127.0.0.1:$PORT/v1/models" || fail "server never became reachable"

code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/v1/models")"
[ "$code" = "200" ] || fail "/v1/models answered $code through the launcher"
echo "ok: /v1/models = 200 through launcher -> standalone server"

LOG="$TMP/.9router/server.log"
[ -s "$LOG" ] || fail "server.log is empty — the launcher is discarding the server's stdout again"
echo "ok: server.log captured ($(wc -l < "$LOG") lines)"

# systemd signals the launcher; the launcher must ASK the server to stop
# (SIGKILL cannot be caught, so killing it here drops the drain).
kill -TERM $LAUNCHER
wait $LAUNCHER
echo "ok: launcher exited $?"

grep -aq "\[Shutdown\] persistence drained" "$LOG" \
  || fail "server was killed without draining — check cleanup() in cli/cli.js"
echo "ok: server drained before exit"
grep -a "\[Shutdown\]\|\[Usage\] shutdown drain" "$LOG" | tail -2 | sed 's/^/     /'

echo "PASS: shutdown topology intact"
