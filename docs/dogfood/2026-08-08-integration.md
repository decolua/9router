# 9Router Federation — Real-Use Integration Report (2026-08-08)

_Author: coding-hermes dogfood run. Verdict: 🔴 DOES-NOT-DELIVER (federation).
Companion: `docs/dogfood/diagnostics.md` (how it's built + why), `skills/9router-federation-usage/SKILL.md` (how to deploy/test it). Board: FED-011..FED-016._

## What was tested

The fork's promise: *"Deploy the same 9router on multiple instances; edges proxy `/v1` to
central by default, replicate central's SQLite, and keep serving from a local replica when
central dies (writes queued, reconciled later)."*

Real deployment, not the test harness:

- **Central** — `FEDERATION_MODE=central`, port 20131, own `DATA_DIR`, shared
  `FEDERATION_TOKEN`/`JWT_SECRET`/`API_KEY_SECRET`/`INITIAL_PASSWORD`.
- **Edge** — `FEDERATION_MODE=edge`, `FEDERATION_CENTRAL_URL=http://127.0.0.1:20131`,
  port 20132, own `DATA_DIR`, `FEDERATION_SYNC_INTERVAL_MS=2000`,
  `FEDERATION_HEARTBEAT_INTERVAL_MS=1000`, `FEDERATION_OUTAGE_THRESHOLD_MS=5000`.
- Both booted from an assembled **Dockerfile.federation runtime layout** (`.next/standalone`
  + `custom-server.js` + `open-sse` + `src/` + `@` alias → exactly what the federation
  image contains) via `node custom-server.js` — the same entry the containers use.
- **Upstream**: a local mock Ollama-compatible server (`POST /api/chat`, `GET /api/tags`)
  so real `/v1` traffic flowed through the whole pipeline without external credentials.

## The happy path that worked (standalone/central = the upstream product)

1. Dashboard login (`POST /api/auth/login` with `INITIAL_PASSWORD`).
2. `POST /api/keys` → API key `sk-…` created.
3. `POST /api/providers` → `ollama-local` connection with
   `providerSpecificData.baseUrl` pointing at the mock upstream.
4. `POST /v1/chat/completions` on **central** → real completion from the mock upstream.

The base 9router gateway is real and works. **Everything below is the federation layer.**

## The federation workflow, as it actually failed

| # | Step (documented) | What actually happened |
|---|---|---|
| 1 | Edge boots, starts replication poll | **Replication never ran.** After 6+ min against a live central: edge replica `providerConnections=0`, `apiKeys=0`, `settings=0`, `federation_meta.lastAppliedRevision=null`, zero `edgeClient`/`failover` log lines. `edgeClient.start()`/`failover.start()` are called **only** by the e2e harness (`tests/federation/e2e-child.mjs`), never by `custom-server.js`/`instrumentation.js`/any real entry point. |
| 2 | Client calls edge `/v1/chat/completions` with its API key | Edge **did proxy** (proxy-up-by-default when state ≠ DEGRADED) but central answered `{"error":{"message":"Invalid API key"}}` — `buildUpstreamHeaders` moves the client's `Authorization` to `X-9r-Client-Authorization` (which central's /v1 auth does **not** read; code comment: *"the header is inert when absent"*) and sends `Authorization: Bearer <FEDERATION_TOKEN>` upstream. Same key works directly on central. |
| 3 | `curl /api/federation/status -H "Authorization: Bearer $FEDERATION_TOKEN"` (runbook §5) | `401 Unauthorized`. `src/proxy.js` (Next 16 middleware) denies `/api/*` by default; `/api/federation` is not in `PUBLIC_API_PATHS`, so dashboardGuard 401s **before** roleGuard's token check runs. `local-status` (documented as "token-less, local only") also 401s without a dashboard session cookie. |
| 4 | Kill central (SIGKILL) | Edge flipped `last_state=degraded` via the one-shot proxy `onUpstreamFailure` hook (~instant, good). But DEGRADED `/v1` serving returned `Invalid API key` — the replica is empty (step 1), so "dependent services never go down" fails exactly when it matters. |
| 5 | Degraded write (`POST /api/keys` on edge) | ✅ **Worked**: `202 Accepted` + `X-Federation-State: degraded` + `X-Federation-Queued-Write-Id`, row in `pendingWrites`. |
| 6 | Restart central | **No recovery.** 15s+ after central returned: edge still `degraded`, `pendingWrites` never drained, central never saw the queued key. Nothing polls for recovery because the heartbeat loop was never started. |

## Friction log (every stuck point)

- FED-012: runbook curls fail with bare `Unauthorized` (no hint about dashboardGuard).
- FED-013: no log line anywhere says "replication disabled/not started" — the edge
  silently runs with an empty replica; `local-status` even reports `last_state: "linked"`
  (default when the meta row is empty), actively masking the problem.
- FED-014: `npm run start` (README production path) doesn't load `custom-server.js` at
  all → zero federation behavior, zero error.
- FED-015: the plain `Dockerfile` image ships without `src/lib/federation` (dynamic
  imports aren't traced; only `Dockerfile.federation` copies `src/`) → `FEDERATION_MODE=edge`
  on the plain image is silently inert (fail-open import).
- FED-011: model routing needed the provider prefix (`ollama-local/mock-model-7b`, not
  `mock-model-7b`) — cosmetic, documented nowhere obvious; minor.
- FED-016: central `/api/federation/status` reports `revisionLag: 3` on itself
  (`maxVersion: 3`, `lastAppliedRevision: 0`), which looks like a broken replica.

## The meta-finding

The board's "e2e 17/17 PASS" is real but narrow: the harness (`tests/federation/e2e.mjs` →
`e2e-child.mjs`) builds a **framework-free HTTP server**, starts the loops **manually**,
and **bypasses Next's dashboardGuard entirely**. It proves the federation modules work in
isolation — not that the app wires them up. The app integration (start the loops, pass the
guard, keep the client auth) was never exercised by any test. This is the exact
premature-completion pattern: L1/L2 verified, L3 (a real user hitting a real edge) never.

## What a user should do right now

- Standalone 9router: use it, it works (that's upstream's product).
- Federation: **do not deploy for production** until FED-011..FED-013 are fixed and the
  acceptance checks below pass. Queued writes during an outage are currently unrecoverable
  (no drain), and authenticated clients are rejected through any edge.
- The only working federation paths today are the unit tests and the e2e harness.

## Acceptance checks (after fixes)

```bash
# A: replication converges
curl -s http://127.0.0.1:20132/api/federation/local-status   # revisionLag -> 0, apiKeys>0 in replica

# B: proxied authenticated traffic works
curl -s -X POST http://127.0.0.1:20132/v1/chat/completions \
  -H "Authorization: Bearer <client-key>" -H 'Content-Type: application/json' \
  -d '{"model":"ollama-local/<model>","messages":[{"role":"user","content":"ping"}]}'
# -> 200 with the upstream completion (not Invalid API key)

# C: documented federation API works with Bearer only (no cookies)
curl -s http://127.0.0.1:20131/api/federation/status -H "Authorization: Bearer $FEDERATION_TOKEN"

# D: full lifecycle: kill central -> edge DEGRADED + still serves /v1 from replica;
#    restart central -> RECOVERING -> LINKED, pendingWrites drained, central reconciled
```

## Scratch environment

The exact repro (mock upstream, boot scripts, DB inspectors) is preserved under
`/tmp/dogfood-9router/` on the dogfood host; logs in `/tmp/dogfood-9router/logs/`.
