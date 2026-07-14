# Live Verification Hybrid Soak Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only, sanitized live verifier and complete the initial `T+0` checkpoint for a four-checkpoint manual 24-hour soak.

**Architecture:** A Node.js verifier owns gate evaluation, sanitized reporting, and exit classification; a small shell wrapper provides the operator-facing command. Dependencies are injected through a command adapter so tests never access live PM2, SQLite, WARP, logs, or the network. Scheduler installation remains outside this plan.

**Tech Stack:** Node.js ESM, built-in `node:test`/`assert`, `node:child_process`, `node:fs`, `node:path`, `node:sqlite`, Bash.

## Global Constraints

- The verifier is read-only: no deployment, restart, rollback, repair, database write, or configuration mutation.
- Never print or persist credentials, proxy URLs, cookies, tokens, raw Cloudflare trace, location, colo, raw provider responses, connection IDs, names, emails, or serialized DB rows.
- Required exit codes are exactly `0` for pass, `1` for operational failure, and `2` for usage/dependency/configuration error.
- Network operations use bounded timeouts of at most 15 seconds; the WARP trace check uses at most 5 seconds.
- Sensitive providers are exactly `antigravity`, `xai`, and `github`.
- A strict connection requires both top-level `strictProxy === true` and nested `providerSpecificData.strictProxy === true`.
- Reports live only under `.runtime/verification-reports`, are mode `0600`, and are never overwritten.
- The canary defaults to `cx/gpt-5.6-sol`, is opt-in, and emits no raw prompt or response.
- Do not modify `scripts/deploy-9router.sh` or any scheduler in this plan.
- Preserve the unrelated dirty `.gitignore`; stage only intended files.
- Use TDD: verify RED before implementation and GREEN afterward.

---

## File Structure

- Create `scripts/lib/liveVerifier.mjs` — pure orchestration, gate evaluation, sanitization, report construction, and exit classification.
- Create `scripts/verify-live-9router.mjs` — production command adapter and CLI argument parsing.
- Create `scripts/verify-live-9router.sh` — stable executable wrapper that launches Node with SQLite support.
- Create `tests/scripts/live-verifier.test.mjs` — injected-fixture unit and integration coverage without live dependencies.
- Create `.runtime/verification-reports/.gitkeep` only if the directory is not already ignored; otherwise create reports at runtime without tracking the directory.
- Create `docs/operations/live-verification-soak.md` — operator command contract and checkpoint procedure.

### Task 1: Pure gate engine and exit contract

**Files:**
- Create: `scripts/lib/liveVerifier.mjs`
- Create: `tests/scripts/live-verifier.test.mjs`

**Interfaces:**
- Produces: `runVerification(options, adapter) -> Promise<{exitCode, overall, gates, summary}>`
- Produces: `classifyExit(gates) -> 0 | 1 | 2`
- `adapter` exposes async methods named `deployJournal`, `gitState`, `liveState`, `pm2State`, `warpState`, `strictProxyState`, `guardState`, `logState`, and `canaryState`.

- [ ] **Step 1: Write failing tests for healthy, operational-failure, and configuration-error runs**

Create fixture adapters returning sanitized objects. Assert a healthy required-gate run returns `exitCode: 0`; a WARP-off gate returns `1`; and a malformed/missing prerequisite represented as `status: "error"` returns `2`. Assert non-canary runs include `canary: {status: "not_run"}`.

```js
const healthy = {
  deployJournal: async () => ({ status: "pass", state: "DONE" }),
  gitState: async () => ({ status: "pass", expectedCommit: "abc", upstream: "abc" }),
  liveState: async () => ({ status: "pass", liveCommit: "abc", version: "0.5.20" }),
  pm2State: async () => ({ status: "pass", processStatus: "online", unstableRestarts: 0 }),
  warpState: async () => ({ status: "pass", listening: true, warp: true }),
  strictProxyState: async () => ({ status: "pass", total: 11, strict: 11, drift: 0 }),
  guardState: async () => ({ status: "pass", httpStatus: 401 }),
  logState: async () => ({ status: "pass", findings: 0 }),
  canaryState: async () => ({ status: "pass", httpStatus: 200, model: "cx/gpt-5.6-sol" }),
};
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/scripts/live-verifier.test.mjs`  
Expected: FAIL because `scripts/lib/liveVerifier.mjs` does not exist.

- [ ] **Step 3: Implement minimal orchestration and classification**

Implement a fixed ordered gate list. Catch adapter exceptions and convert them to `{status:"error", reason:"check_failed"}`. Never include exception messages. Configuration errors dominate operational failures when computing the exit code.

- [ ] **Step 4: Add continuation and sanitization tests**

Assert all safe adapters are called after one gate fails; injected secret-like extra properties do not appear in `JSON.stringify(result.summary)`; only allowlisted properties are copied into the summary.

- [ ] **Step 5: Run tests and verify GREEN**

Run: `node --test tests/scripts/live-verifier.test.mjs`  
Expected: all Task 1 tests pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/liveVerifier.mjs tests/scripts/live-verifier.test.mjs
git commit -m "test(ops): define live verification gate contract"
```

### Task 2: Production adapters for deploy, Git, live endpoints, and PM2

**Files:**
- Create: `scripts/verify-live-9router.mjs`
- Modify: `tests/scripts/live-verifier.test.mjs`

**Interfaces:**
- Produces: `parseArgs(argv)` with `--expected-commit`, `--checkpoint`, `--report`, `--canary`, and `--canary-model`.
- Produces: `createSystemAdapter(config)` implementing all adapter methods.
- Consumes: `runVerification(options, adapter)` from Task 1.

- [ ] **Step 1: Write failing tests for argument validation and four core adapters**

Cover unknown flags and missing flag values as exit `2`; journal state other than `DONE`; source mismatch; behind/diverged upstream; exact health body requirement; malformed version JSON; zero/multiple PM2 processes; non-online status; and unstable restarts greater than zero.

Use injected `run(command, args, options)` and `fetch(url, options)` functions. Tests must assert fixed argv arrays are used rather than shell interpolation.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test --test-name-pattern='args|journal|git|live|PM2' tests/scripts/live-verifier.test.mjs`  
Expected: FAIL because the CLI module/adapters are absent.

- [ ] **Step 3: Implement argument parsing and core adapters**

Resolve defaults relative to repository root:

```js
const defaults = {
  liveBaseUrl: "http://127.0.0.1:20128",
  globalCliDir: `${process.env.HOME}/.npm-global/lib/node_modules/9router`,
  dataFile: `${process.env.HOME}/.9router/db/data.sqlite`,
  warpProxy: "socks5h://127.0.0.1:40000",
  reportDir: ".runtime/verification-reports",
  canaryModel: "cx/gpt-5.6-sol",
};
```

Read `.deploy-latest`, parse only the final `STATE` field from its journal, resolve expected commit from the argument or `git rev-parse HEAD`, use `git rev-list --left-right --count HEAD...@{upstream}`, fetch health/version with timeout, and parse `pm2 jlist` without printing raw JSON.

- [ ] **Step 4: Run focused and full tests**

Run: `node --test --test-name-pattern='args|journal|git|live|PM2' tests/scripts/live-verifier.test.mjs`  
Expected: focused tests pass.  
Run: `node --test tests/scripts/live-verifier.test.mjs`  
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-live-9router.mjs tests/scripts/live-verifier.test.mjs
git commit -m "feat(ops): add core live verification adapters"
```

### Task 3: WARP, strict-proxy, guard, and log gates

**Files:**
- Modify: `scripts/verify-live-9router.mjs`
- Modify: `tests/scripts/live-verifier.test.mjs`

**Interfaces:**
- Completes: `warpState`, `strictProxyState`, `guardState`, and `logState` adapter methods.
- `strictProxyState` returns only `{status,total,strict,drift}`.

- [ ] **Step 1: Write failing security-gate tests**

Cover listener absent, proxied trace without exact `warp=on`, strict drift, SQLite open failure, guard returning a status other than `401`, and logs containing either `Proxy failed, falling back to direct` or `Invalid URL protocol`. Assert test fixtures containing proxy URLs, `colo=`, `loc=`, connection identity fields, and exception text never enter summaries.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test --test-name-pattern='WARP|strict|guard|logs' tests/scripts/live-verifier.test.mjs`  
Expected: FAIL because security adapters are incomplete.

- [ ] **Step 3: Implement the four adapters**

Use `ss -ltn` only to determine whether `127.0.0.1:40000` is listening. Invoke curl with `--proxy`, `--max-time 5`, and the fixed Cloudflare trace URL, then retain only whether a line exactly equals `warp=on`.

Open SQLite read-only with `DatabaseSync(dataFile, {readOnly:true})`. Execute one aggregate query over sensitive providers; do not select identity columns or return rows:

```sql
SELECT provider, data
FROM providerConnections
WHERE provider IN ('antigravity','xai','github')
```

Parse each JSON value in memory and retain only aggregate counts. Fetch the guard endpoint unauthenticated. Determine the deployment start timestamp from the latest journal and query bounded PM2 logs; retain only finding counts.

- [ ] **Step 4: Run focused and full tests**

Run the focused command from Step 2, then `node --test tests/scripts/live-verifier.test.mjs`.  
Expected: all tests pass and no test accesses live services.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-live-9router.mjs tests/scripts/live-verifier.test.mjs
git commit -m "feat(ops): verify WARP and strict proxy invariants"
```

### Task 4: Optional canary and immutable sanitized reports

**Files:**
- Modify: `scripts/lib/liveVerifier.mjs`
- Modify: `scripts/verify-live-9router.mjs`
- Modify: `tests/scripts/live-verifier.test.mjs`

**Interfaces:**
- Canary configuration: `{enabled:boolean, model:string, apiKey?:string}`.
- Report configuration: `{enabled:boolean, checkpoint:string, reportDir:string}`.
- Report filename: `<ISO-basic>-<sanitized-checkpoint>.json`.

- [ ] **Step 1: Write failing canary/report tests**

Cover canary success, HTTP failure, empty assistant response, missing required canary configuration, invalid checkpoint characters, report mode `0600`, path containment, and collision failure. Assert reports contain only the spec allowlist and never raw response, authorization header, prompt, proxy URL, or raw trace.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test --test-name-pattern='canary|report' tests/scripts/live-verifier.test.mjs`  
Expected: FAIL because canary/report behavior is absent.

- [ ] **Step 3: Implement canary and report writing**

Use a fixed prompt held only in memory, POST JSON with `stream:false` and bounded timeout, and set `Authorization` only from `NINEROUTER_CANARY_API_KEY` when present. Parse only HTTP status, response model, and whether assistant content is non-empty.

Sanitize checkpoint labels to `^[A-Za-z0-9+._-]+$`. Resolve the report path under the configured report root, create the root with mode `0700`, and write with flags `wx` and mode `0600`. Build report JSON from allowlisted summary fields only.

- [ ] **Step 4: Run focused and full tests**

Run focused command from Step 2, then `node --test tests/scripts/live-verifier.test.mjs`.  
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/liveVerifier.mjs scripts/verify-live-9router.mjs tests/scripts/live-verifier.test.mjs
git commit -m "feat(ops): add sanitized soak checkpoints"
```

### Task 5: Shell entry point and operator documentation

**Files:**
- Create: `scripts/verify-live-9router.sh`
- Create: `docs/operations/live-verification-soak.md`
- Modify: `tests/scripts/live-verifier.test.mjs`

**Interfaces:**
- Operator command: `./scripts/verify-live-9router.sh [options]`.
- T+0 command: `./scripts/verify-live-9router.sh --checkpoint T+0 --report --canary`.

- [ ] **Step 1: Write failing wrapper tests**

Spawn the wrapper with an injected fixture mode or temporary adapter configuration. Assert argument forwarding and preservation of child exit codes `0`, `1`, and `2`.

- [ ] **Step 2: Run wrapper tests and verify RED**

Run: `node --test --test-name-pattern='wrapper' tests/scripts/live-verifier.test.mjs`  
Expected: FAIL because the wrapper does not exist.

- [ ] **Step 3: Implement wrapper and documentation**

Wrapper contents must be limited to strict shell mode, repository-root resolution, and `exec node --experimental-sqlite scripts/verify-live-9router.mjs "$@"`.

Document the exact commands:

```bash
./scripts/verify-live-9router.sh --checkpoint T+0 --report --canary
./scripts/verify-live-9router.sh --checkpoint T+1h --report
./scripts/verify-live-9router.sh --checkpoint T+6h --report
./scripts/verify-live-9router.sh --checkpoint T+24h --report --canary
```

State that each invocation is manual, no sleeping/background process is created, scheduler work requires separate approval, and canary credentials must be supplied only through `NINEROUTER_CANARY_API_KEY` if required.

- [ ] **Step 4: Validate wrapper and documentation**

Run: `bash -n scripts/verify-live-9router.sh`  
Expected: exit `0`.  
Run: `node --test tests/scripts/live-verifier.test.mjs`  
Expected: all tests pass.  
Run: `git diff --check`  
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-live-9router.sh docs/operations/live-verification-soak.md tests/scripts/live-verifier.test.mjs
git commit -m "docs(ops): document manual verification soak"
```

### Task 6: Security review and live T+0 acceptance checkpoint

**Files:**
- Modify only if review finds a defect: verifier files and their tests.
- Runtime output only: `.runtime/verification-reports/*.json` (untracked).

**Interfaces:**
- Consumes the completed operator command from Task 5.
- Produces the first immutable sanitized `T+0` report.

- [ ] **Step 1: Run the complete automated gate**

```bash
node --test tests/scripts/live-verifier.test.mjs
bash -n scripts/verify-live-9router.sh
git diff --check
```

Expected: zero failures and no diff-check output.

- [ ] **Step 2: Inspect security-sensitive source paths**

Review the final diff and confirm: no shell interpolation of untrusted values; SQLite is read-only; reports use path containment and exclusive creation; exception messages/raw HTTP bodies are not emitted; canary authorization is environment-only; no scheduler/deploy mutation exists.

Run:

```bash
git diff --stat 4ae8a9b..HEAD
git diff 4ae8a9b..HEAD -- scripts tests/scripts docs/operations
```

Expected: only intended verifier, tests, and documentation changes.

- [ ] **Step 3: Run live T+0 checkpoint**

```bash
./scripts/verify-live-9router.sh --checkpoint T+0 --report --canary
```

Expected: exit `0`; every required gate and canary reports `pass`; one mode-`0600` report is created under `.runtime/verification-reports`.

- [ ] **Step 4: Inspect the report for sanitization**

Parse the report and verify required allowlisted fields. Scan for forbidden markers without printing file contents:

```bash
REPORT="$(find .runtime/verification-reports -type f -name '*-T+0.json' -printf '%T@ %p\n' | sort -n | tail -1 | cut -d' ' -f2-)"
node -e 'const fs=require("fs"); const x=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(x.overall!=="pass") process.exit(1)' "$REPORT"
if grep -Eqi 'socks5h?://|authorization|bearer |cookie|token|colo=|loc=|trace=' "$REPORT"; then exit 1; fi
stat -c '%a' "$REPORT"
```

Expected: overall pass, forbidden scan finds nothing, permissions print `600`.

- [ ] **Step 5: Commit any review fixes, otherwise record no source change**

If fixes were required, rerun Steps 1–4 and commit only those fixes:

```bash
git add scripts/verify-live-9router.sh scripts/verify-live-9router.mjs scripts/lib/liveVerifier.mjs tests/scripts/live-verifier.test.mjs docs/operations/live-verification-soak.md
git commit -m "fix(ops): harden live verification reporting"
```

Do not commit runtime reports.

- [ ] **Step 6: Report checkpoint schedule without installing a scheduler**

Report the T+0 evidence and the due times for `T+1h`, `T+6h`, and `T+24h`. Stop after T+0; do not create a sleep process, cron entry, systemd timer, or OpenClaw scheduler task.

## Final Verification Checklist

- [ ] All tests in `tests/scripts/live-verifier.test.mjs` pass.
- [ ] Shell syntax passes.
- [ ] `git diff --check` is clean.
- [ ] `.gitignore` remains untouched and unstaged.
- [ ] No scheduler or deploy script changed.
- [ ] T+0 live run exits `0` with required gates and canary passing.
- [ ] T+0 report is mode `0600`, sanitized, and untracked.
- [ ] Subsequent manual checkpoint commands and scheduler approval boundary are documented.
