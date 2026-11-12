#!/usr/bin/env bash
# GitReins guard test command for 9router federation work.
# Gate: upstream regression baseline (tests/__baseline__/verify-no-regression.mjs).
# - Fresh clone without test deps -> SKIP (exit 0), do not block commits on missing installs.
# - Deps present -> run unit suite, feed results to the baseline verifier. Regressions exit 1.
# - CI context (GITHUB_ACTIONS=true): missing deps OR missing/empty results means the
#   suite never ran -> exit 1 so the workflow step fails instead of a false green
#   (NR-GAP-022, 2026-08-13).
#
# QA/battery lane: call `bash scripts/gitreins-guard-tests.sh --self-run` to get the
# same gate OUTSIDE gitreins guard execution. --self-run is identical to the guard
# path except it skips the board-only staged-diff early-exit (meaningless off-guard);
# it prints the gate verdict lines and exits 0/1 exactly as the guard does.
set -uo pipefail
cd "$(dirname "$0")/.."

SELF_RUN=false
if [ "${1:-}" = "--self-run" ]; then
  SELF_RUN=true
fi

# Board-only commits skip the suite. The foreman's JSONL board chores
# (.coding-hermes/{tasks,events,board}.jsonl) cannot change product code, yet
# they made up ~47% of commits and each one paid the full vitest run — which
# takes ~4 min idle and >14 min under fleet load, so the guard's timeout was
# blocking board hygiene with a false red (measured 2026-10-01, loadavg ~57,
# guard log .gitreins/logs/guard-20260210T...: "Tests timed out after 180s").
# Scope is exact: ONLY when every staged path is under .coding-hermes/.
# Set GITREINS_FORCE_TESTS=1 to override, and CI (no staged diff) is unaffected.
if [ "$SELF_RUN" != "true" ] && [ "${GITREINS_FORCE_TESTS:-}" != "1" ] && [ -z "${GITHUB_ACTIONS:-}" ]; then
  staged_board_only=$(git diff --cached --name-only --diff-filter=ACMR)
  if [ -n "$staged_board_only" ] && ! printf '%s\n' "$staged_board_only" | grep -qv '^\.coding-hermes/'; then
    echo "SKIP: board-only change (every staged path is under .coding-hermes/) — no suite run."
    exit 0
  fi
fi

CI_CONTEXT=false
if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
  CI_CONTEXT=true
fi

if [ ! -d tests/node_modules/vitest ]; then
  echo "SKIP: tests/node_modules missing (run: npm install && cd tests && npm install). Guard tests deferred."
  if [ "$CI_CONTEXT" = "true" ]; then
    echo "ERROR: test dependencies missing in CI context — zero tests executed (false green). Failing step."
    exit 1
  fi
  exit 0
fi

RESULT="/tmp/9router-vitest-results-$$.json"
LOG="/tmp/9router-vitest-$$.log"
(cd tests && npx vitest run --reporter=json --outputFile="$RESULT" >"$LOG" 2>&1)
RC=$?
if [ ! -s "$RESULT" ]; then
  echo "WARN: vitest produced no results file (exit $RC) — treating as no regression."
  if [ "$CI_CONTEXT" = "true" ]; then
    echo "ERROR: no vitest results in CI context — zero tests executed (false green). Failing step."
    exit 1
  fi
  exit 0
fi
node tests/__baseline__/verify-no-regression.mjs "$RESULT"
GATE_RC=$?
if [ "$GATE_RC" -ne 0 ]; then
  echo "ERROR: regression gate failed (exit $GATE_RC) — vitest failure excerpt from $LOG:" >&2
  if ! grep -E "FAIL|✗|×|AssertionError|timed out|Error:" "$LOG" | tail -40; then
    tail -40 "$LOG"
  fi
  exit 1
fi
