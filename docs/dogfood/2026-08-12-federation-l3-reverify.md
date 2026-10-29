# 9Router Federation — L3 Acceptance Re-Verification (2026-08-12)

_Author: 9router foreman tick 170 (NR-GAP-018). Re-runs the acceptance checks from
`docs/dogfood/2026-08-08-integration.md` against the CURRENT `federation` branch, after
the FED-011..FED-016 fixes were marked complete. The 2026-08-08 run (DOES-NOT-DELIVER)
is the baseline: replication never started, auth broke through the edge, the federation
API 401'd, and recovery never happened. All of that is fixed; one NEW integration bug
surfaced by this re-run (machineId on key replay) was fixed and re-verified in this same
run. Companion: `docs/dogfood/diagnostics.md`._

## How it was run

Same repro layout as 2026-08-08 — the Dockerfile.federation runtime layout, not the test
harness:

- App: fresh `npm run build` (2026-08-12, Next 16.3.0 standalone output) assembled per
  `Dockerfile.federation` (`.next/standalone` + `custom-server.js` + `open-sse` + `src/`
  + `@` alias symlink) → `/tmp/9r170-app`.
- **Central** — `FEDERATION_MODE=central`, port 20131, fresh DATA_DIR, shared
  `FEDERATION_TOKEN`/`JWT_SECRET`/`API_KEY_SECRET`/`INITIAL_PASSWORD`.
- **Edge** — `FEDERATION_MODE=edge`, `FEDERATION_CENTRAL_URL=http://127.0.0.1:20131`,
  port 20132, fresh DATA_DIR, `FEDERATION_SYNC_INTERVAL_MS=2000`,
  `FEDERATION_HEARTBEAT_INTERVAL_MS=1000`, `FEDERATION_OUTAGE_THRESHOLD_MS=5000`.
- **Upstream**: mock Ollama server (port 11439) — real `/v1` traffic flowed through the
  whole pipeline. (The mock's streaming mode is not a compliant Ollama SSE stream, so the
  completion check uses `"stream":false` — the same path the 2026-08-08 run used.)
- Seed: dashboard login → `POST /api/keys` (`sk-1413…`) → `POST /api/providers`
  (`ollama-local` → `http://127.0.0.1:11439`).

Edge boot log (the FED-013 fix in action):

```
[federation] replication + failover loops started (edge mode).
```

## Acceptance checks (A–D from docs/dogfood/2026-08-08-integration.md)

### A — Replication converges (<15s) ✅

```bash
$ curl -s http://127.0.0.1:20132/api/federation/local-status
{"role":"edge","mode":"edge","edgeId":"edge","lastAppliedRevision":3,"schemaVersion":4,
 "maxVersion":1,"initialized":true,"last_state":"linked","revisionLag":0}
```

Replica DB (`better-sqlite3` inspector): `providerConnections=1`, `apiKeys=1`,
`federation_meta.lastAppliedRevision=3`. 2026-08-08 baseline: all zeros /
`lastAppliedRevision=null` — replication now runs and converges within the 15s budget
(2s sync interval, observed <10s).

### B — Authenticated /v1 proxying through the edge ✅

```bash
$ curl -s -X POST http://127.0.0.1:20132/v1/chat/completions \
    -H "Authorization: Bearer sk-1413d3d24d80a507-mmimad-fca372ad" \
    -H 'Content-Type: application/json' \
    -d '{"model":"ollama-local/mock-model-7b","stream":false,"messages":[{"role":"user","content":"ping"}]}'
{"id":"chatcmpl-1786527304054","object":"chat.completion","model":"mock-model-7b",
 "choices":[{"index":0,"message":{"role":"assistant","content":"Hello from the MOCK
 OLLAMA upstream. Federation dogfood run works."},"finish_reason":"stop"}],...}
HTTP 200
```

2026-08-08 baseline: `Invalid API key` (FED-011). The client's `Authorization` now flows
through the edge to central and is honored (`X-9r-Client-Authorization` fallback).

### C — Federation API with Bearer only (no cookies) ✅

```bash
$ curl -s http://127.0.0.1:20131/api/federation/status \
    -H "Authorization: Bearer dogfood-federation-token-0123456789abcdef"
{"role":"central","mode":"central","edgeId":"central","lastAppliedRevision":null,
 "schemaVersion":4,"maxVersion":5,"revisionLag":0,
 "revisionLagNote":"edge-only metric — central/standalone instances have no replica to lag"}
HTTP 200
```

2026-08-08 baseline: `401 Unauthorized` (FED-012, dashboardGuard before roleGuard).
Also note FED-016: central no longer reports a bogus `revisionLag: 3` on itself.

### D — Full lifecycle: kill central → DEGRADED → serve from replica → recover + drain ✅ (after fix)

1. Kill central (SIGKILL). Edge log:
   `[federation] heartbeat failed 4x over 7067ms (threshold 4209ms) — edge DEGRADED.`
   `local-status` → `last_state:"degraded"` within ~8s.
2. Degraded `/v1` from the replica (central still dead) → **HTTP 200** with the mock
   completion. 2026-08-08 baseline: `Invalid API key` (empty replica).
3. Queued write while degraded:

```bash
$ curl -s -i -X POST http://127.0.0.1:20132/api/keys \
    -H 'Content-Type: application/json' -d '{"name":"queued-round3"}'
HTTP/1.1 202 Accepted
X-Federation-State: degraded
X-Federation-Queued-Write-Id: be56ff09-1b67-433e-9d31-03d249bec126
{"queued":true,"idempotencyKey":"be56ff09-1b67-433e-9d31-03d249bec126",
 "message":"Write queued locally; will be replayed to central on recovery"}
```

4. Restart central. Edge re-links (heartbeat succeeds → RECOVERING → drain → catch up →
   LINKED). `local-status` → `last_state:"linked"`, `lastAppliedRevision` advances.
5. Reconciliation verified:
   - edge `pendingWrites` row → `state:"done"`
   - central key list now contains `queued-round3` (`sk-1413d3d24d80a507-nchia5-ed5fa4b0`,
     `machineId: 1413d3d24d80a507` = central's server-derived machine id)
   - the new key replicated BACK to the edge (`lastAppliedRevision 5 → 6`)

## NEW finding fixed in this run: queued key writes failed replay (machineId)

The first two D runs exposed a real integration bug the unit/e2e suites had missed:
replayed `POST /api/keys` writes failed on central with `"machineId is required"`, so the
edge's queued writes drained to `failed` (attempts 2, one stale-fence retry) and were
never reconciled.

Root cause: the edge queues the client's raw request body (`{name: …}`), and
`applyReplayMutation` (src/lib/federation/server.js) passed `body?.machineId ?? null`
straight to `createApiKey` — which throws on a null machineId. The direct `/api/keys`
route derives `machineId` server-side (`getConsistentMachineId()`), so the replay path
was stricter than the real route. The linked-proxy path never hits this (central's route
handles the request), so only degraded-mode queued writes broke.

Fix (src/lib/federation/server.js, `applyReplayMutation`): when the replayed body omits
`machineId`, derive it server-side exactly like the direct route — central's machine id,
which is also what the linked path would have produced. Regression test added in
`tests/federation/failover.test.js` ("replays POST /api/keys without machineId — derives
it server-side (L3 dogfood regression)"); `federation/failover.test.js` 16/16 pass.

The two pre-fix `failed` rows in the edge DB are by-design no-retry evidence (queue
contract: 4xx/5xx → failed, never retried) — a fresh queued write after the fix drained
cleanly (`state:"done"`).

## Verdict

**Federation L3 acceptance now PASSES end-to-end** on the current `federation` branch:
convergence, authenticated proxying, Bearer-only federation API, DEGRADED failover with
replica serving, queued writes, and recovery drain + reconciliation. The 2026-08-08
DOES-NOT-DELIVER findings (FED-011..016) are resolved in practice; the one new gap found
by this re-run (machineId on key replay) is fixed and regression-tested. Remaining
tooling note: the mock upstream's streaming mode is not valid Ollama SSE, so stream-mode
completions fail upstream-validation — a mock limitation, not a product bug (2026-08-08
run used the same non-streaming path).
