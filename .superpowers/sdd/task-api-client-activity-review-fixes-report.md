# API-key client activity review fixes report

## Status

`DONE_WITH_CONCERNS`

- Branch: `api-key-client-activity-fixes`
- Starting commit: `fe6366e768fa4e7196a21b46a822c7a48e8e5870`
- Requirements source: `.superpowers/sdd/task-api-client-activity-review-fixes-brief.md`
- No dependency added. No push performed. No service started.

## Delivered behavior

- Custom HTTP wrapper now strips spoofable peer/proof and forwarding headers,
  stamps a random per-process proof, and is mandatory for Node, Bun, packaged
  CLI, and Docker production starts.
- Bare Next/dev requests cannot establish local status through Host or fake
  `x-9r-*` headers. Dashboard auth and login limiting trust peer metadata only
  with the valid process proof.
- `TRUST_PROXY` defaults closed. Header presence on loopback remains proxied
  even when malformed; `TRUST_PROXY=true` preserves Cloudflare direct,
  cross-zone Worker, and generic reverse-proxy resolution. Direct public
  sockets always use socket identity.
- IPv4, IPv4-mapped IPv6, and IPv6 spellings canonicalize before fingerprint
  and loopback checks. Displays retain only IPv4 `/24` and IPv6 `/48` masks.
- Activity-side Codex detection is local. Native passthrough detector expansion
  from PR #2553 was reverted exactly.
- API-key-authenticated chat, messages, responses, Gemini, embeddings, image,
  TTS, STT, search, web fetch, and video create/poll paths enqueue one admitted
  inbound request after endpoint validation. Invalid/missing keys and malformed
  requests enqueue none. Provider retry/fusion paths do not enqueue again.
- Activity persistence coalesces exact counts in a bounded memory buffer:
  64 identities per key, 6,400 globally, one transaction no more often than
  every 5 seconds, unref'd one-shot timer, 64 durable identities per key, and
  60-day retention.
- API-key deletion/deactivation clears pending entries; deleted IDs cannot be
  re-enqueued. Activity output is newest 2,000 rows with `truncated`.
- Schema version 3 adds `idx_akc_last(lastSeen DESC)` while retaining
  `idx_akc_key_last(apiKeyId, lastSeen DESC)`.
- Usage UI displays admitted `seenRequests`, uses generic source labels, shows
  visible token breakdown, exposes a focusable labelled horizontal region,
  reports truncation, and distinguishes loading/error/stale/empty states.

## TDD ledger

Every production change followed a failing regression run. Tests were edited
first, expected failure was observed, then minimum production code was added.

### Baseline

Command:

```sh
NODE_PATH=./node_modules ./node_modules/.bin/vitest run --config tests/vitest.config.js tests/unit/api-key-client-activity.test.js tests/unit/api-key-client-identity.test.js tests/unit/api-key-client-usage-meta.test.js tests/unit/db-migration-chain.test.js tests/unit/dashboard-guard.test.js --reporter=verbose
```

Result: `5 files passed, 34 tests passed`.

### Request-origin, proxy, and launch RED

Commands covered `dashboard-guard.test.js`, `client-ip.test.js`,
`custom-server.test.js`, `login-limiter-origin.test.js`, and
`production-launch-contract.test.js`.

Observed RED:

- Bare loopback Host and fake loopback `x-9r-real-ip` bypassed API auth.
- Valid proof was not recognized for IPv6 stamped peer input.
- Trust-disabled loopback accepted forwarding identity.
- Node/Bun starts bypassed wrapper; Docker omitted `client-ip.js`; CLI allowed
  bare `server.js` fallback; `TRUST_PROXY` was undocumented.
- Custom wrapper did not generate/stamp proof or pass trust policy.
- Login limiter accepted unproved internal IP.

Representative result: `5 failed, 25 passed`; additional wrapper/launch run:
`2 failed`; login limiter run: `1 failed`.

GREEN command:

```sh
NODE_PATH=./node_modules ./node_modules/.bin/vitest run --config tests/vitest.config.js tests/unit/custom-server.test.js tests/unit/client-ip.test.js tests/unit/dashboard-guard.test.js tests/unit/login-limiter-origin.test.js tests/unit/production-launch-contract.test.js --reporter=verbose
```

Result: `5 files passed, 32 tests passed` at phase completion. Later audit cases
for malformed proxy headers, IPv4 `127/8`, IPv6 Origin, and root `next start`
dispatch also failed first and passed after their focused fixes.

### Identity and routing isolation RED

Command:

```sh
NODE_PATH=./node_modules ./node_modules/.bin/vitest run --config tests/vitest.config.js tests/unit/api-key-client-identity.test.js tests/unit/client-ip.test.js --reporter=verbose
```

Observed RED: `5 failed, 12 passed`.

- Unproved peer headers created identity.
- Expanded/compressed IPv6 produced different fingerprints.
- IPv4-mapped IPv6 did not share IPv4 fingerprint or `/24` mask.
- Expanded IPv6 was not canonical.
- `codex_cli_rs` changed native passthrough detection.

GREEN result: `2 files passed, 17 tests passed`. Later `/48` trailing `::` and
full IPv4 loopback regressions failed first, then finished at `19/19`.

### Bounded persistence RED

Command:

```sh
NODE_PATH=./node_modules ./node_modules/.bin/vitest run --config tests/vitest.config.js tests/unit/api-key-client-activity.test.js tests/unit/api-key-client-buffer.test.js tests/unit/db-migration-chain.test.js --reporter=verbose
```

Observed RED: `9 failed, 4 passed`.

- ID-based enqueue absent; 65th/6,401st bounds absent.
- Flush API/timer absent; writes happened inline.
- Stale prune, durable cap, output truncation, and polling index absent.
- Pending deletion could not be flushed safely.

GREEN result: `3 files passed, 13 tests passed` at phase completion.
Additional audit regressions for five-second flush pacing and post-deletion
enqueue each failed first. Final buffer suite: `9/9 passed`.

### Endpoint admission RED

Command:

```sh
NODE_PATH=./node_modules ./node_modules/.bin/vitest run --config tests/vitest.config.js tests/unit/api-key-client-endpoints.test.js tests/unit/api-key-client-tracker.test.js tests/unit/request-origin-sanitization.test.js tests/unit/gemini-native-endpoint.test.js --reporter=verbose
```

Observed RED: `14 failed, 21 passed`; tracker module was absent, which produced
the expected missing-feature suite failure.

- All 12 valid endpoint cases recorded zero tracker calls.
- Gemini native recorded zero activity.
- Proof/full peer IP remained in raw request headers.
- Tracker validation/fail-open warning behavior was absent.

GREEN result: `4 files passed, 38 tests passed`.

Google-style key extraction then ran RED separately:

```sh
NODE_PATH=./node_modules ./node_modules/.bin/vitest run --config tests/vitest.config.js tests/unit/sse-api-key-extraction.test.js --reporter=verbose
```

Observed RED: `1 failed`; GREEN: `1 passed`.

### Usage UI RED

Initial render attempt exposed Vitest's inability to parse JSX in `.js`; test
was corrected before production edits to source-contract checks plus a pure
state reducer test. Correct RED command:

```sh
NODE_PATH=./node_modules ./node_modules/.bin/vitest run --config tests/vitest.config.js tests/unit/api-key-client-ui.test.js --reporter=verbose
```

Observed RED: `3 failed`.

- UI used successful usage-row `requests` instead of admitted `seenRequests`.
- Deployment-specific source labels and tooltip-only token detail remained.
- Accessible region, truncation state, explicit load/error/stale states, and
  period-safe reducer were absent.

GREEN with activity API naming check: `2 files passed, 4 tests passed`.

## Final verification

### Focused activity/auth/endpoint/routing suite

Command: Vitest over 26 focused files covering activity, buffer, identity,
tracker, UI, usage metadata, client IP, custom server, dashboard guard,
migrations, Gemini native, login limiter, launch contract, sanitization,
Google key extraction, image/TTS/video endpoints, combo routing/fusion,
force-stream behavior, and model/provider routing.

Result: `26 files passed, 162 tests passed, 0 failed`.

### Targeted lint

Command: `./node_modules/.bin/eslint` over every changed production JS module.

Result: exit `0`, no findings.

### Production build

Command:

```sh
DATA_DIR=/home/home/.openclaw/workspace-keyra/9router-api-client-activity/.superpowers/sdd/build-data npm run build
```

Result: exit `0`; compiled, TypeScript completed, `130/130` static pages
generated, build traces collected. Temporary build DB removed afterward.

### Diff hygiene

Command: `git diff --check`

Result: exit `0`, no whitespace errors.

### Full unit-suite audit

Unfiltered command:

```sh
NODE_PATH=./node_modules ./node_modules/.bin/vitest run --config tests/vitest.config.js tests/unit --reporter=json
```

Result: `1,141 tests total; 1,093 passed; 24 failed; 24 pending; 27 failed suites`.
No changed activity/auth/endpoint/routing test failed. Remaining failures are
pre-existing branch/environment debt, including absent `cloud/`, absent
`lowdb`, a live MiMo test, stale translator/capability expectations, OAuth
platform mocks, image network mocks, and existing usage concurrency tests.
The stale force-stream headroom mock needed by required routing verification
was updated; its focused suite now passes `3/3`.

## Compatibility notes

- Provider selection, model routing, translation, response bodies, retry
  behavior, and usage token semantics were not changed.
- `open-sse/utils/clientDetector.js` is restored to its pre-PR behavior.
- `/api/usage/clients` now calls successful usage-row count
  `successfulRequests`; admitted activity remains `seenRequests`.
- Bare Next dev remains available but is not a trusted local boundary. Public
  inference through bare dev requires normal API/CLI authorization.
- Operators must set `TRUST_PROXY=true` only when their trusted proxy overwrites
  forwarding headers. No deployment-specific default was added.
- Schema version advances from 2 to 3 for the polling index.

## Residual ceilings

- Pending identities: 64 per API key, 6,400 globally.
- Durable identities: 64 per API key, retained 60 days.
- Flush interval: 5 seconds; crash loss ceiling is one interval.
- Activity response: newest 2,000 rows with `truncated`; no pagination.
- Complete historical anomaly evidence requires the documented durable
  event-stream upgrade path.

## Concerns

1. First non-isolated `npm run build` invocation timed out after compilation and
   page generation and accessed default `/home/home/.9router`. It applied schema
   migration #3 and created schema backup files there. No service was started.
   External state was not reverted because task ownership is limited to this
   worktree. All later builds used worktree-local `DATA_DIR` and passed.
2. Full branch unit suite remains red for unrelated baseline/environment issues
   listed above. Required focused suite, lint, build, and diff hygiene pass.
3. Successful build emitted non-fatal `/bin/sh: hostname: command not found`
   after route output while still exiting `0`.

## Changed files

- `.env.example`
- `Dockerfile`
- `cli/cli.js`
- `client-ip.js`
- `custom-server.js`
- `open-sse/utils/clientDetector.js`
- `package.json`
- `src/app/(dashboard)/dashboard/usage/components/ApiKeyClientsTable.js`
- `src/app/(dashboard)/dashboard/usage/components/apiKeyClientState.js`
- `src/app/api/v1beta/models/[...path]/route.js`
- `src/dashboardGuard.js`
- `src/lib/apiKeyClientIdentity.js`
- `src/lib/auth/loginLimiter.js`
- `src/lib/db/index.js`
- `src/lib/db/migrations/003-api-key-clients-last-seen-index.js`
- `src/lib/db/migrations/index.js`
- `src/lib/db/repos/apiKeyClientsRepo.js`
- `src/lib/db/repos/apiKeysRepo.js`
- `src/lib/db/schema.js`
- `src/lib/localDb.js`
- `src/lib/requestOrigin.js`
- `src/shared/components/UsageStats.js`
- `src/sse/handlers/chat.js`
- `src/sse/handlers/embeddings.js`
- `src/sse/handlers/fetch.js`
- `src/sse/handlers/imageGeneration.js`
- `src/sse/handlers/search.js`
- `src/sse/handlers/stt.js`
- `src/sse/handlers/tts.js`
- `src/sse/handlers/videoGeneration.js`
- `src/sse/services/apiKeyClientActivity.js`
- `src/sse/services/auth.js`
- `tests/unit/api-key-client-activity.test.js`
- `tests/unit/api-key-client-buffer.test.js`
- `tests/unit/api-key-client-endpoints.test.js`
- `tests/unit/api-key-client-identity.test.js`
- `tests/unit/api-key-client-tracker.test.js`
- `tests/unit/api-key-client-ui.test.js`
- `tests/unit/client-ip.test.js`
- `tests/unit/custom-server.test.js`
- `tests/unit/dashboard-guard.test.js`
- `tests/unit/db-migration-chain.test.js`
- `tests/unit/force-stream-config.test.js`
- `tests/unit/gemini-native-endpoint.test.js`
- `tests/unit/login-limiter-origin.test.js`
- `tests/unit/production-launch-contract.test.js`
- `tests/unit/request-origin-sanitization.test.js`
- `tests/unit/sse-api-key-extraction.test.js`
- `.superpowers/sdd/task-api-client-activity-review-fixes-report.md`
