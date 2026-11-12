# 9Router Federation — Real-Use Integration Report (2026-08-20)

_Author: coding-hermes dogfood run (cron). Verdict: 🟡 PROMISING-BUT-ROUGH — the
federation feature now WORKS end-to-end (L3 acceptance A–D all pass on a real
deployment), but one P1 replication-integrity bug and two P2 gaps remain.
Companion: `docs/dogfood/diagnostics.md`, `skills/9router-federation-usage/SKILL.md`.
Board: FED-020..FED-022._

## What was tested

The fork's promise: *"Deploy the same 9router on multiple instances; edges proxy
`/v1` to central by default, replicate central's SQLite, and keep serving from a
local replica when central dies (writes queued, reconciled later)."*

This run is the **re-test after the 2026-08-08 🔴 DOES-NOT-DELIVER verdict**
(FED-011..FED-016, all marked fixed) and the 2026-08-12 L3 reverify claim. Method:
**real deployment from the documented bare-metal path** — no test harness, no e2e
script. The 2026-08-08 report's acceptance checks A–D were re-run verbatim against
current `federation` HEAD.

- **Build**: fresh `npm run build` at HEAD `10bb05d3` (Next 16.3.0, webpack).
  Postbuild assembles `.next/standalone` + `custom-server.js` automatically.
- **Central** — repo root, `node custom-server.js` (what `npm run start` runs, FED-014
  fix): `FEDERATION_MODE=central`, port 20131, fresh `DATA_DIR`, shared
  `FEDERATION_TOKEN`/`JWT_SECRET`/`API_KEY_SECRET`/`INITIAL_PASSWORD` (dogfood-* values).
- **Edge** — same repo root, port 20132, fresh `DATA_DIR`,
  `FEDERATION_SYNC_INTERVAL_MS=2000`, `FEDERATION_HEARTBEAT_INTERVAL_MS=1000`,
  `FEDERATION_OUTAGE_THRESHOLD_MS=5000`, `FEDERATION_EDGE_ID=edge`.
- **Upstream**: mock Ollama (port 11439, native `/api/chat` + `/api/tags`).
- **Seed** (dashboard API, real login): `POST /api/auth/login` → `POST /api/keys`
  (`sk-1413d3d24d80a507-2brcg2-8dee2f36`) → `POST /api/providers` (`ollama-local` →
  `http://127.0.0.1:11439`).
- Scratch env preserved at `/tmp/dogfood-9router/run-2026-08-20/` (data dirs, logs,
  delta payloads).

## Acceptance checks (A–D) — all PASS ✅

### A — Replication converges

```
$ curl -s http://127.0.0.1:20132/api/federation/local-status
{"role":"edge","mode":"edge","edgeId":"edge","lastAppliedRevision":3,"schemaVersion":4,
 "maxVersion":3,"initialized":true,"last_state":"linked","revisionLag":0}
```

Edge boot log: `[federation] replication + failover loops started (edge mode).` —
loops start from the real entry point (FED-013 fix; in the 08-08 run this line never
appeared and the replica stayed empty). Edge replica: `apiKeys=1, providerConnections=1`
(both seeded rows), `lastAppliedRevision=3` within ~10s. **08-08 baseline: all zeros.**

### B — Authenticated /v1 proxying through the edge

```
$ curl -s -X POST http://127.0.0.1:20132/v1/chat/completions \
    -H "Authorization: Bearer sk-1413d3d24d80a507-2brcg2-8dee2f36" \
    -H 'Content-Type: application/json' \
    -d '{"model":"ollama-local/mock-model-7b","stream":false,"messages":[{"role":"user","content":"ping through edge"}]}'
{"id":"chatcmpl-…","object":"chat.completion","model":"mock-model-7b","choices":[…"Federation dogfood run works."…]}
HTTP 200
```

**08-08 baseline: `Invalid API key`** (FED-011 — client `Authorization` now flows
through the edge to central via `X-9r-Client-Authorization`).

### C — Federation API with Bearer only (no cookies)

`/api/federation/status`, `/verify`, `/snapshot?since=0`, `/delta?since=2` all HTTP
200 with `Authorization: Bearer <FEDERATION_TOKEN>`; token-less
`/api/federation/local-status` also 200. Central reports `revisionLag:0` +
`revisionLagNote` (FED-016 fix). **08-08 baseline: 401 Unauthorized** (FED-012).

### D — Full lifecycle: kill central → DEGRADED → serve from replica → recover + drain ✅

1. Central SIGKILLed. Edge log: `[federation] heartbeat failed 4x over 7007ms
   (threshold 5018ms) — edge DEGRADED.` → `local-status` `last_state:"degraded"` ~7s.
2. `/v1` on the edge while central is DEAD → **HTTP 200** with the completion
   (served from the local replica). **08-08 baseline: `Invalid API key`** (empty
   replica). *"Dependent services never go down" holds.*
3. Queued write while degraded:
   `POST /api/keys {"name":"queued-during-outage"}` → `202 Accepted` +
   `X-Federation-State: degraded` + `X-Federation-Queued-Write-Id: 3a7bce1e-…`.
4. Central restarted → edge re-linked (heartbeat success → RECOVERING → drain →
   catch-up → LINKED). `local-status` → `last_state:"linked"`,
   `lastAppliedRevision: 3 → 4`.
5. Reconciliation verified: edge `pendingWrites` row `state:"done", attempts:0,
   last_error:null`; **central now contains `queued-during-outage`
   (`sk-1413d3d24d80a507-je92ra-edbc7fd5`)**; the key replicated BACK to the edge
   (`apiKeys=2`); the replayed key authenticates through the edge → 200 + completion
   (full circle: client key → edge → central → upstream).

**08-08 baseline: edge stuck DEGRADED forever, queue never drained (FED-013).**

## NEW findings (this run)

### FED-020 (P1) — delta-applied replica rows lose version metadata

After the lifecycle, the edge's replica rows were inconsistent with central:

| row | central | edge |
|---|---|---|
| `dogfood-key` (bootstrap, snapshot path) | `federation_version=1` | `federation_version=1` ✅ |
| `queued-during-outage` (delta path) | `federation_version=4` | `federation_version=0`, `updated_at=NULL` ❌ |
| `providerConnections` (re-stamped on central at 10:16:47 → v5, delta path) | `federation_version=5` | `federation_version=0` ❌ |

Root cause (code): `applyRevisionBatch` delta branch in
`src/lib/federation/replication.js`:

```js
for (const { table, row } of rows) {
  upsertLogicalRow(db, table, row);
}
```

The wire delta entry is `{table, row, federation_version, updated_at, deleted}`
(version at **entry** level — verified in the live `/api/federation/delta` payload),
but the loop passes only the inner `row` to `upsertLogicalRow`, which reads
`entry.federation_version` → always `0`. The **snapshot** branch passes the full
entry, so bootstrap rows are correct — which is why `replication.test.js` (24 tests,
bootstrap-heavy) never caught it.

Consequence: the edge's local watermark (`maxVersion`) diverges from
`lastAppliedRevision` — observed `lastAppliedRevision:5, maxVersion:1`,
`revisionLag` clamped to 0. A genuinely stale edge with delta-updated rows would
report `revisionLag:0` and look healthy. One-line fix direction + regression test in
the task.

### FED-021 (P2) — revisionLag metric derives from the corrupted local watermark

`buildLocalStatusPayload` computes `revisionLag = max(0, localWatermark -
lastAppliedRevision)`. Lag should be measured against **central's advertised
watermark** (the delta payload's `maxVersion`, which the edge already receives every
poll). As written, the metric can't distinguish "replica healthy" from "replica
version metadata corrupted" (FED-020). FED-016 fixed the central-side self-lag; this
is the edge-side twin.

### FED-022 (P2) — settings never replicate via delta

Edge replica `settings=0` after the full lifecycle. Root cause: the boot-time
settings seed (`src/lib/db/migrate.js:116`, raw `INSERT INTO settings(id, data)
VALUES(1, ?)` — password hash + defaults) bypasses stamping, so the settings row has
`federation_version=NULL`; the delta query `federation_version > ?` excludes NULL
forever. `settingsRepo.js:107` does stamp, so a settings change made via the
dashboard later would replicate — but the seed never does, and a fresh edge only
gets settings if its first snapshot happens after central seeded. Docs/constants
claim 8 replicated tables; in practice settings replicates only via snapshot timing.

## Friction log

1. **Streaming (`stream:true`) fails with the mock upstream** — `503 Provider error
   (reset after 15s)` direct on central, `(reset after 30s)` through the edge
   (proxy adds timeout budget). Identical on central → **not federation-specific**;
   consistent with the 08-12 reverify's "mock stream format not a compliant Ollama
   SSE stream" note. Worth re-verifying against a real Ollama before shipping, but
   out of the federation fork's scope.
2. Model routing needs the provider prefix (`ollama-local/mock-model-7b`, not
   `mock-model-7b`) — known from 08-08, still undocumented anywhere obvious (the
   dashboard hides this when you pick a provider; a curl user must guess).
3. Provider API shapes (`/api/providers` body with `providerSpecificData.baseUrl`,
   login body `{password}`) required reading source — `docs/api-reference.md`
   covers `/v1` only. Minor for dashboard users, real friction for headless users.
4. Edge proxy adds ~2x upstream timeout on failure paths (15s → 30s) — cosmetic.

## Verdict

**🟡 PROMISING-BUT-ROUGH.** The 2026-08-08 🔴 DOES-NOT-DELIVER verdict is
**resolved in practice**: every acceptance check A–D passes on a real deployment
with real HTTP traffic, and the previously-dead loops start from the real entry
point. The federation value proposition (edge → central proxying, replica failover,
queued writes, recovery drain) is real and demonstrated. What keeps it from
SHIPPABLE: the delta-apply version corruption (FED-020) makes the replica's version
metadata untrustworthy and the status surface potentially misleading — exactly the
class of "looks fine, isn't" issue that FED-016 was filed for. Fix FED-020 (+FED-021
metric, +FED-022 settings) and re-run A–D, and this is a shippable federation
feature.

Time-to-first-success: ~3 min (standalone `/v1` completion direct on central);
federation convergence (edge replica populated): ~10s after seeding; full
failover/recovery lifecycle verified in ~15 min of wall-clock testing. Friction
count: 4 (above), none blocking.

## Scratch environment

`/tmp/dogfood-9router/run-2026-08-20/` — central-data/, edge-data/, logs/
(central.log, edge.log, mock-ollama.log), cookies, delta0.json (wire payload
evidence), plus `inspect-*.cjs` read-only DB inspectors. Reusable mock:
`/tmp/dogfood-9router/mock-ollama.mjs` (port 11439).
