# 9Router Federation — Deployment Guide

_Status: FED-006 (final phase). Authoritative design: `docs/federation-spec.md`.
Companion files: `docker-compose.federation.yml` (example), `Dockerfile.federation`
(federation-capable image), `tests/federation/e2e.mjs` (lifecycle proof)._

Federation lets you run the SAME 9router system on multiple instances across
datacenters/hosts. Edge instances proxy up to a CENTRAL instance by default
(all `/v1` traffic + mutating dashboard API), continuously replicate the
central database, and — if central goes down — keep serving independently
from their local replica. Writes during an outage are queued locally and
reconciled when central returns.

**Standalone mode is the default and is unchanged.** Every `FEDERATION_*`
env var is optional; with none set, an instance behaves exactly like
upstream 9router.

---

## 1. Roles

| Role | `FEDERATION_MODE` | Behavior |
|---|---|---|
| **standalone** | unset / `standalone` | Current upstream behavior. No federation code runs (zero drift). |
| **central** | `central` | Single authoritative writer. Serves its own dashboard, `/v1` pipeline and the federation API (`/api/federation/{snapshot,delta,verify,status,replay}`). Every write to a replicated table stamps a monotonically increasing `federation_version`. |
| **edge** | `edge` | Maintains a local SQLite replica. **LINKED**: proxies `/v1/*` + mutating dashboard API up to `FEDERATION_CENTRAL_URL`. **DEGRADED**: serves `/v1` + dashboard reads from the local replica; writes go to a local `pendingWrites` queue. **RECOVERING**: drains the queue, catches up deltas, returns to LINKED. |

Edges **never self-promote** — there is exactly one writer (central) by
design, and split-brain is prevented by DB-layer write guards, a fencing
lease, and the state machine.

---

## 2. Deployment topologies

### 2.1 Single central + N edges (recommended)

```
                 ┌──────────────┐
   clients ────► │   central    │  authoritative writer + dashboard
                 └──────┬───────┘
                        │ federation API (snapshot/delta/verify/replay)
              ┌─────────┴──────────┐
              │                    │
      ┌───────┴───────┐    ┌───────┴───────┐
      │    edge-a     │    │    edge-b     │   local replica + dashboard
      └───────────────┘    └───────────────┘
```

- Clients (CLI tools, apps) point at the nearest edge's `/v1` endpoint.
- LINKED edges forward `/v1` + mutating dashboard API to central; dashboard
  GET reads resolve locally from the warm replica.
- If central dies, each edge flips to DEGRADED and keeps serving `/v1` from
  its replica — dependent services never go down.
- This is the topology in `docker-compose.federation.yml` (central + 2 edges).

### 2.2 Per-datacenter edge (geo distribution)

One edge per datacenter, each with its own replica and dashboard. Clients
use the edge in their region (low latency); all writes converge on central.
During a central outage every regional edge degrades independently and
queues writes locally; on recovery each drains its own queue. The
`FEDERATION_EDGE_ID` distinguishes edges in central's lease/status.

### 2.3 Edge-only degraded serving (read-mostly)

An edge whose `FEDERATION_REDACT_FIELDS` strips provider credentials from
replicated rows (see §4) is safe to expose to less-trusted networks. Such an
edge can still serve `/v1` from its replica while DEGRADED, but providers
whose credentials were redacted will not be usable from that edge — document
this trade-off per edge.

### 2.4 What NOT to do

- **Two centrals** — the protocol is single-writer. A second central is a
  second writer and will diverge. There is no central election.
- **Edge without `FEDERATION_CENTRAL_URL`** — the edge cannot proxy or
  replicate; it serves only its (empty) local replica.
- **Mismatched `FEDERATION_TOKEN`** — every federation API call 401s; the
  edge stays LINKED-on-paper but every proxy/replication call fails.

---

## 3. Env matrix

All `FEDERATION_*` vars are optional. Defaults live in
`src/lib/federation/config.js` / `constants.js`.

| Var | Default | Applies to | Meaning |
|---|---|---|---|
| `FEDERATION_MODE` | `standalone` | all | `standalone` \| `central` \| `edge`. Invalid values throw at boot (no silent fallback). |
| `FEDERATION_CENTRAL_URL` | — | edge | Central base URL, e.g. `https://central.example.com`. Required for proxying + replication. |
| `FEDERATION_TOKEN` | — | central + edge | Shared secret, sent as `Authorization: Bearer` on every federation API call and proxied request. **Never reuse `JWT_SECRET`/`API_KEY_SECRET` for this.** |
| `FEDERATION_EDGE_ID` | `node-machine-id` | edge | Edge identity; shown in central's lease/status and used for fencing ownership. Set it explicitly in containers (machine-id is per-container). |
| `FEDERATION_SYNC_INTERVAL_MS` | `5000` | edge | Delta poll interval (replication catch-up). |
| `FEDERATION_HEARTBEAT_INTERVAL_MS` | `2000` | edge | Verify heartbeat interval (liveness + lease renewal). |
| `FEDERATION_OUTAGE_THRESHOLD_MS` | `15000` | edge | Consecutive heartbeat failures spanning this window (jittered ±20%, with reconnect backoff) flip the edge to DEGRADED. A proxy-side 502/timeout flips immediately. |
| `FEDERATION_QUEUE_MAX` | `10000` | edge | `pendingWrites` cap. When full, new degraded writes get 503. |
| `FEDERATION_REPLAY_BATCH_SIZE` | `50` | edge | Replay batch size when draining the queue on recovery. |
| `FEDERATION_REDACT_FIELDS` | — | edge | Comma-separated JSON paths redacted from replicated provider/API-key rows (proxy-only edges). |

### 3.1 Non-federation vars that matter

| Var | Sharing policy |
|---|---|
| `DATA_DIR` | Per-instance (each instance has its own SQLite replica). In Docker, one volume per instance. |
| `PORT` | Per-instance (each instance listens on its own port). |
| `JWT_SECRET` | **Share across all instances.** Dashboard sessions are signed with it; a mismatched secret makes the dashboard on one instance reject sessions issued by another. |
| `API_KEY_SECRET` | **Share across all instances.** API keys are derived from it; a mismatch makes `/v1` keys issued on central invalid on edges (and vice versa). |
| `INITIAL_PASSWORD` | Share if you want the same first-login password everywhere. |
| `MACHINE_ID_SALT` | Share if machine-id-derived values (e.g. default `FEDERATION_EDGE_ID`) must be stable across instances. |
| `BASE_URL` / `NEXT_PUBLIC_BASE_URL` | Per-instance public URL (used by internal sync jobs / UI links). |

> **Mismatch warning:** `/api/federation/status` reports role + schemaVersion
> + revision. A JWT/API_KEY_SECRET mismatch does not break the federation
> protocol itself (it uses `FEDERATION_TOKEN`), but it breaks cross-instance
> dashboard sessions and API-key validation — the most common "everything
> links but nothing works" cause. Keep the three secrets identical on every
> instance.

### 3.2 Setting up `FEDERATION_TOKEN`

```bash
# Generate once, use on every instance:
openssl rand -hex 32
```

Put the same value in every instance's env (`.env`, compose `environment:`,
or the orchestrator's secret store). The token is compared in constant time
(SHA-256 pre-hash) and never appears in dashboard responses — the config
page only reports "configured yes/no".

---

## 4. Replication model

- **What replicates:** the 8 logical config tables — `settings`,
  `providerConnections`, `providerNodes`, `proxyPools`, `apiKeys`,
  `modelAliases`, `combos`, `pricing` (aliases/pricing are `kv` rows).
- **What stays local:** usage telemetry (`usageHistory`, `usageDaily`,
  `requestDetails`) — high-churn, host-local by design.
- **Protocol:** edge PULL over HTTPS JSON.
  - `GET /api/federation/snapshot?since=0` — full snapshot (bootstrap).
  - `GET /api/federation/delta?since=<revision>` — rows newer than the
    edge's last applied revision + tombstones + watermark + schemaVersion.
  - `GET /api/federation/verify` — heartbeat; renews the central lease and
    returns a fresh `fencing_token`.
  - `GET /api/federation/status` — diagnostics (role, revision, schema).
  - `POST /api/federation/replay` — edge replays a queued write with its
    fencing token + idempotency key.
- **Schema gating:** if central advertises a newer schemaVersion than the
  edge's migrations, the edge pauses apply with **SCHEMA_BLOCKED** (see
  §6.4) — nothing is partially applied.
- **Fencing:** each heartbeat renews a lease (60s TTL) and issues a fresh
  fencing token. Replays presenting a stale token are rejected 409; the
  edge re-verifies once for a fresh token and retries once. A restarted
  central invalidates old tokens, so a zombie edge cannot apply writes
  against a lease it no longer holds.

---

## 5. Failover runbook

### 5.1 Outage detection

1. Edge heartbeats `GET /api/federation/verify` every
   `FEDERATION_HEARTBEAT_INTERVAL_MS`.
2. After consecutive failures spanning `FEDERATION_OUTAGE_THRESHOLD_MS`
   (jittered ±20% + bounded reconnect backoff), the edge flips to
   **DEGRADED** and logs:
   `[federation] heartbeat failed Nx over Xms (threshold Yms) — edge DEGRADED.`
3. A proxy-side 502/timeout while LINKED flips immediately (no waiting for
   the threshold).

**Verify:** `curl http://edge:20128/api/federation/local-status` →
`"last_state": "degraded"` (token-less, local only).

### 5.2 Degraded serving

- `/v1/*` is served from the local replica through the unchanged chat
  pipeline (accounts, combos, keys, aliases read from local tables).
- Dashboard reads resolve from the local replica; responses carry
  `X-Federation-State: degraded`.
- Mutating dashboard API calls are queued to `pendingWrites` and respond
  `202 Accepted` with `X-Federation-State: degraded` +
  `X-Federation-Queued-Write-Id`. When the queue is full
  (`FEDERATION_QUEUE_MAX`), new writes get `503`.
- The dashboard banner shows DEGRADED (red) + revision lag.

**Verify:** `curl -i http://edge:20128/v1/models` → `source: local-replica`
+ `X-Federation-State: degraded` header.

### 5.3 Recovery / reconcile

1. A heartbeat succeeds → edge flips to **RECOVERING**.
2. The `pendingWrites` queue drains to central in batches
   (`FEDERATION_REPLAY_BATCH_SIZE`) via fenced `POST /api/federation/replay`
   (idempotency keys never double-apply; stale fences re-verify once).
3. Deltas catch up (`lastAppliedRevision` → central watermark).
4. Edge returns to **LINKED**; proxying resumes.

**Verify:** `local-status` shows `"last_state": "linked"` and
`revisionLag: 0`; central's data contains the queued writes.

### 5.4 Fencing (split-brain guard)

- Central issues a fresh `fencing_token` + 60s lease on every verify.
- Replays must present the CURRENT token; stale → `409 FED_STALE_FENCE`.
- After a central restart, old tokens are dead — a zombie edge's replay is
  rejected, it re-verifies, and retries once. A second 409 marks the write
  `failed` (surfaced in diagnostics) — never silently dropped.

### 5.5 Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Edge stays LINKED but `/v1` 502s | `FEDERATION_CENTRAL_URL` unreachable from the edge (firewall, DNS, TLS). Check `curl https://central/api/federation/verify` with the token. |
| Federation API calls 401 | `FEDERATION_TOKEN` mismatch. Regenerate once and set identically everywhere. |
| Dashboard sessions break across instances | `JWT_SECRET` mismatch. |
| `/v1` keys invalid on edges | `API_KEY_SECRET` mismatch. |
| Edge never catches up (`revisionLag` grows) | `FEDERATION_SYNC_INTERVAL_MS` too high, or central overloaded. Check central logs for slow delta builds. |
| `SCHEMA_BLOCKED` (see below) | Edge migration version < central's. Upgrade the edge image. |
| Writes marked `failed` in the queue | Replay 409'd twice (stale fence) or 4xx. Check `pendingWrites.last_error` via diagnostics. |
| Edges flip DEGRADED too eagerly | Raise `FEDERATION_OUTAGE_THRESHOLD_MS` (and/or heartbeat interval). |
| Edges flip DEGRADED too slowly | Lower `FEDERATION_OUTAGE_THRESHOLD_MS`; or rely on the immediate proxy-502 flip. |

---

## 6. Operations

### 6.1 Docker (example compose)

```bash
# Build + start central + 2 edges (see docker-compose.federation.yml):
docker compose -f docker-compose.federation.yml up -d --build

# Check status:
docker compose -f docker-compose.federation.yml ps
curl http://localhost:20128/api/federation/status -H "Authorization: Bearer $FEDERATION_TOKEN"
curl http://localhost:20129/api/federation/local-status   # edge-a
curl http://localhost:20130/api/federation/local-status   # edge-b

# Simulate a central outage:
docker compose -f docker-compose.federation.yml stop central
# ...edges flip DEGRADED after the threshold; /v1 keeps working on 20129/20130...

# Recover:
docker compose -f docker-compose.federation.yml start central
# ...edges drain + catch up + return to LINKED...
```

The example uses `Dockerfile.federation` (the standalone Dockerfile plus the
`src/` tree and `@/` alias the federation runtime modules need — Next's file
tracing does not follow custom-server.js's dynamic imports). If you publish
a federation image, swap `build:` for `image:`.

### 6.2 Bare-metal / VM

Run the normal production build (`npm run build && PORT=... npm run start`)
on each instance with the env matrix above. The federation API routes are
part of the Next app; the edge proxy/failover hooks live in
`custom-server.js`, which `npm run start` boots in front of the standalone
server (the Docker CMD runs the same `node custom-server.js` entry).

### 6.3 TLS

The federation protocol carries provider credentials and API keys. **Use
TLS in production** — put a terminator (Caddy/Traefik/nginx) in front of
central and set `FEDERATION_CENTRAL_URL` to the `https://` URL. The compose
example uses plain `http://central:20128` for local testing only.

### 6.4 SCHEMA_BLOCKED

When central advertises a schemaVersion newer than the edge's local
migrations, the edge pauses apply (nothing applied, `lastAppliedRevision`
untouched) and surfaces an "upgrade edge" banner. Fix: deploy the newer
image to the edge. Apply resumes automatically from the same revision —
deltas are version-ordered, so nothing is lost.

### 6.5 Upgrades

1. Upgrade **edges first** (they must be at least central's schemaVersion).
2. Upgrade central last.
3. Rolling restarts are safe: a restarting edge re-bootstraps from its
   `lastAppliedRevision` (or snapshot if fresh); a restarting central
   invalidates old fencing tokens, which edges handle by re-verifying.

---

## 7. Verification

The end-to-end lifecycle proof is a standalone script (not a vitest file):

```bash
node tests/federation/e2e.mjs
```

It spawns 3 real instances (central + 2 edges) with temp DATA_DIRs and
ports and proves: standalone boot → LINKED (heartbeat + replication) →
kill central → DEGRADED (replica serving + queued writes) → restart central
→ RECOVERING → replay drain + delta catch-up → LINKED → writes reconcile.
Prints a PASS/FAIL summary; exit code reflects the result.

The unit suite (from `tests/`) is gated by the regression baseline:

```bash
cd tests && npx vitest run --reporter=json --outputFile=/tmp/results.json
node tests/__baseline__/verify-no-regression.mjs /tmp/results.json
```

---

## 8. Reference

- `docs/federation-spec.md` — authoritative design (roles, protocol, state
  machine, env table, risks).
- `src/lib/federation/config.js` — env parsing + defaults.
- `src/lib/federation/server.js` — central route handlers.
- `src/lib/federation/replication.js` — snapshot/delta/apply.
- `src/lib/federation/edgeClient.js` — edge pull + poll loop.
- `src/lib/federation/proxy.js` — edge forwarding middleware.
- `src/lib/federation/failover.js` — LINKED/DEGRADED/RECOVERING state machine.
- `src/lib/federation/queue.js` — pendingWrites + replay.
- `src/lib/federation/roleGuard.js` — Bearer auth for federation routes.
- `docker-compose.federation.yml` — central + 2 edges example.
- `Dockerfile.federation` — federation-capable image.
- `tests/federation/e2e.mjs` — lifecycle proof.
