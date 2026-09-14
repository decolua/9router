# 9Router Federation — Implementation Spec

_Status: APPROVED (multi-model design: gpt-5.6-sol + grok-4.5 + glm-5.2 workers,
claude-fable-5 aggregator, 2026-08-07). Authoritative for board tasks FED-001..FED-006.
DuckBrain mirror: ns `9router`, keys `/project/9router/federation/*`._

## 1. Goal

Deploy the SAME 9router system on multiple instances across datacenters/hosts:

1. **Edge instances proxy up to the CENTRAL instance by default** (all `/v1/*` traffic + mutating dashboard API).
2. **Edges continuously track/replicate the central instance's SQLite database** so if central
   goes down, edges keep serving independently — services depending on them never go down.
3. **Frontend runs once per datacenter or per host** (each instance serves its own `/dashboard`,
   backed by local replica or central).
4. **Writes during a central outage** are absorbed/queued locally and reconciled later
   (eventual consistency).
5. **Clean, mergeable PR to upstream** — standalone mode remains the default; all federation
   code is inert unless `FEDERATION_MODE` is set.

## 2. Verified Codebase Facts (2026-08-07 master)

- Plain JS ESM, Next.js 16 app router. `/v1/*` → next rewrites → `src/app/api/v1/*` →
  `src/sse/handlers/chat.js` → `open-sse/handlers/chatCore.js` → `open-sse/executors/*`.
  The SSE pipeline is stateless per request and DB-driven → edge-safe.
- SQLite adapter chain (`src/lib/db/driver.js`): `bun:sqlite` → `better-sqlite3` →
  `node:sqlite` (Node ≥22.5) → `sql.js` (pure-JS). DB at `DATA_DIR/db/data.sqlite`
  (`DATA_DIR` default `~/.9router`). WAL mode. Declarative schema `src/lib/db/schema.js`
  (auto-sync) + versioned migrations `src/lib/db/migrations/`.
- Replicated-config tables: `settings` (single row), `providerConnections`,
  `providerNodes`, `proxyPools`, `apiKeys`, `modelAliases`, `combos`, `pricing`.
- **Usage is NOT a separate file anymore**: `src/lib/usageDb.js` is a shim re-exporting
  `src/lib/db/repos/usageRepo.js` (SQLite-backed: statsEmitter, saveRequestUsage,
  getUsageHistory, appendRequestLog…). High-churn, host-local telemetry — stays local
  per instance, no replication (optional read-only roll-up).
- **`exportDb()` already exists** in `src/lib/db/index.js` — full snapshot of settings +
  providerConnections + providerNodes + proxyPools + apiKeys (+ combos/aliases/pricing in
  the same shape). Reuse as the snapshot serialization source.
- **The "cloud sync" documented in docs/ARCHITECTURE.md does NOT exist in current master.**
  No `/api/sync/*` route, no `initCloudSync.js`, no `cloudSyncScheduler.js`. Only vestigial
  `settings.cloudEnabled` + `CLOUD_URL`/`NEXT_PUBLIC_CLOUD_URL` env + UI references
  (`BaseUrlSelect.js`, `KiloToolCard.js`). Federation sync is a FRESH BUILD — do not hunt
  for legacy sync code. (CLAUDE.md/ARCHITECTURE.md are stale on this.)
- `custom-server.js` wraps the Next standalone server: derives client IP from the TCP
  socket and strips attacker-controlled `X-Forwarded-For` (trusts loopback proxy only).
  **This is the proxy insertion point** for federation forwarding (arbitrary methods/bodies,
  SSE piping with flush/backpressure, abort propagation, fall-through to local handlers).
- Auth env: `JWT_SECRET` (session cookie), `INITIAL_PASSWORD`, `API_KEY_SECRET`,
  `MACHINE_ID_SALT` (machine id via `node-machine-id`).
- Tests: vitest in `tests/` (independent ESM package). Suite is NOT all-green by design
  (~938 pass / ~64 known-fail, `tests/__baseline__/known-fails.txt`). Regression gate:
  `node tests/__baseline__/verify-no-regression.mjs <results.json>`. New federation tests
  must be additive and pass.

## 3. Architecture

### 3.1 Roles (env-driven)

```
FEDERATION_MODE=standalone|central|edge   (default: standalone — zero behavior change)
```

- **CENTRAL** — single authoritative writer. Serves own dashboard/API/SQLite/`/v1` pipeline.
  Every mutation to a replicated table assigns a monotonically increasing
  `federation_version`. Hosts `/api/federation/*` endpoints.
- **EDGE** — maintains a local SQLite replica. In **LINKED** state proxies up to
  `FEDERATION_CENTRAL_URL` by default. In **DEGRADED** state serves `/v1` + dashboard reads
  from the local replica; writes go to a local `pendingWrites` queue.
- **STANDALONE** — current behavior, untouched.

### 3.2 Edge proxy (proxy-up-by-default)

- **Forwarding layer: `custom-server.js` middleware**, BEFORE Next.js dispatch. It can proxy
  arbitrary methods/bodies, preserve SSE status/headers/chunks with flush + backpressure,
  propagate aborts, and fall through to local handlers when DEGRADED. Next rewrites cannot
  do per-request-state fallback.
- LINKED edge forwards: `/v1/*` (chat/completions, messages, responses, models,
  count_tokens) + mutating dashboard API (`/api/settings`, `/api/providers*`,
  `/api/keys*`, `/api/models/alias`, `/api/combos*`, `/api/pricing`, `/api/usage` writes).
- Dashboard GET reads may resolve locally from the replica (fast, warm) — but responses
  must reflect authoritative state; verify-on-read is acceptable.
- Edge→central auth: dedicated `FEDERATION_TOKEN` (never reuse JWT_SECRET/API_KEY_SECRET),
  sent as `Authorization: Bearer` on proxied requests; TLS required outside dev.
- Route-handler shared helper (`src/lib/federation/roleGuard.js`) enforces
  role/write policy for requests that bypass custom-server.js (tests, alternate hosting).

### 3.3 Replication

- **Replicate config tables only** (the 8 listed in §2). Usage stays local.
- Protocol: **edge PULL over HTTPS JSON** from a dedicated `/api/federation/*` namespace:
  - `GET /api/federation/snapshot?since=0` — full snapshot (via `exportDb()` shape +
    version columns).
  - `GET /api/federation/delta?since=<lastAppliedRevision>` — rows where
    `federation_version > since` + tombstones + `max_version` watermark + `schemaVersion`.
  - `GET /api/federation/verify` — heartbeat: token + edgeId, echoes central lease +
    schemaVersion.
  - `GET /api/federation/status` — role, revision, schema version, lease (diagnostics).
- **Schema changes** (new numbered migration, idempotent, adapter-chain safe):
  - `federation_version INTEGER`, `updated_at`, `deleted` (tombstone) on the 8 tables.
  - `federation_meta` (role, edgeId, lastAppliedRevision, schemaVersion, last_state,
    leaseOwner/leaseExpiry/fencing_token) — single row.
  - `pendingWrites` (edge-only): id, method, path, body JSON, idempotency_key,
    created_at, attempts, last_error.
- Edge bootstraps with `snapshot?since=0`, then polls `delta?since=<revision>` every
  `FEDERATION_SYNC_INTERVAL_MS`. Apply is transactional per revision batch; unknown
  migration version → `SCHEMA_BLOCKED`, pause apply, surface "upgrade edge" banner.
- Conflict/versioning: single-writer (central) means last-writer-wins by
  `federation_version`; edge mutations to replicated rows are BLOCKED at the DB layer
  while LINKED. Fencing: central renews lease; stale-fenced replays rejected 409.

### 3.4 Failover (edge state machine)

```
LINKED → DEGRADED → RECOVERING → LINKED     (state persisted in federation_meta.last_state)
```

- **LINKED**: proxy-up; heartbeat `GET /api/federation/verify` every
  `FEDERATION_HEARTBEAT_INTERVAL_MS`; after consecutive failures spanning
  `FEDERATION_OUTAGE_THRESHOLD_MS` (with ±20% jitter + backoff to avoid thundering herd)
  → DEGRADED. A proxy-side 502/timeout can flip immediately.
- **DEGRADED**: stop proxying; serve `/v1` from local replica through the UNCHANGED
  `src/sse/handlers/chat.js → chatCore.js → executors` pipeline (accounts, combos, keys,
  aliases read from local tables — this is why config replication keeps dependent
  services alive). Dashboard reads → local replica. Mutating dashboard API calls →
  `pendingWrites` queue (idempotency_key dedupe), respond with
  `X-Federation-State: degraded` + `X-Federation-Queued-Write-Id`. Queue capped at
  `FEDERATION_QUEUE_MAX` (reject with 503 when full). `/api/sync/cloud` actions disabled
  while degraded.
- **RECOVERING**: heartbeat succeeds → drain `pendingWrites` to central (replay with
  idempotency keys, reject 409-stale) → catch up deltas → LINKED.
- **No self-promotion**: edges never become central. Split-brain is prevented by
  design (single writer + write-guards + fencing).

### 3.5 Frontend (once per datacenter / per host)

- Every instance serves its own Next.js `/dashboard` — no separate frontend build.
- Central: dashboard APIs read/write authoritative local state.
- LINKED edge: browser talks to same-origin edge; custom-server.js forwards mutating API
  calls to central with federation auth (token never reaches browser JS).
- DEGRADED edge: reads → local replica + local usage; writes → queue (see §3.4).
- UX: `FederationStatus` banner component (LINKED/DEGRADED/RECOVERING + revision lag).

## 4. Env Vars (all optional; standalone unaffected)

| Var | Default | Meaning |
|---|---|---|
| `FEDERATION_MODE` | `standalone` | `standalone` \| `central` \| `edge` |
| `FEDERATION_CENTRAL_URL` | — | Central base URL (edge only) |
| `FEDERATION_TOKEN` | — | Shared secret, Bearer auth edge↔central |
| `FEDERATION_EDGE_ID` | `node-machine-id` | Edge identity |
| `FEDERATION_SYNC_INTERVAL_MS` | `5000` | Delta poll interval |
| `FEDERATION_HEARTBEAT_INTERVAL_MS` | `2000` | Verify heartbeat interval |
| `FEDERATION_OUTAGE_THRESHOLD_MS` | `15000` | Consecutive-failure window → DEGRADED |
| `FEDERATION_QUEUE_MAX` | `10000` | pendingWrites cap |
| `FEDERATION_REPLAY_BATCH_SIZE` | `50` | Replay batch on recovery |
| `FEDERATION_REDACT_FIELDS` | — | Optional JSON-path redaction (proxy-only edges) |

## 5. Implementation Phases (PR order — board tasks FED-001..FED-006)

1. **FED-001 — Config + schema.** `src/lib/federation/config.js` (env parsing,
   `isStandalone/isEdge/isCentral`), `constants.js` (`REPLICATE_TABLES`, states);
   schema.js + idempotent migration `00NN_federation.js` (federation_version/updated_at/
   deleted on 8 tables, federation_meta, pendingWrites). Tests: config defaults/env
   precedence; migration idempotency across adapter chain; fresh standalone boot
   unchanged. *Gate: `FEDERATION_MODE` unset ⇒ zero schema/behavior drift vs baseline.*
2. **FED-002 — Replication service + routes.** `src/lib/federation/replication.js`
   (snapshot/delta apply, revision watermark, transactional batches),
   `src/lib/federation/server.js` (central routes: snapshot/delta/verify/status),
   `src/lib/federation/edgeClient.js` (pull + poll loop). Federation hooks in
   `src/lib/db` write paths to stamp `federation_version`. Tests: central snapshot/delta
   correctness; edge apply idempotency; schemaVersion blocking.
3. **FED-003 — Edge proxy + role guard.** `custom-server.js` forwarding middleware
   (method/body/SSE/abort), `src/lib/federation/roleGuard.js` route-handler guard.
   Tests: proxy passthrough of `/v1/chat/completions` (SSE), dashboard API forwarding,
   auth header injection, standalone no-op.
4. **FED-004 — Failover state machine + write queue.** States LINKED/DEGRADED/RECOVERING,
   heartbeat, jittered threshold, pendingWrites repo, replay + idempotency, queue cap.
   Tests: outage flip, degraded serving from replica, queue drain on recovery,
   fencing reject.
5. **FED-005 — Frontend + UX.** `FederationStatus` banner, degraded-mode dashboard
   responses (`X-Federation-State` headers), edge config page (mode/central URL/token),
   i18n strings. Tests: component render states; API header assertions.
6. **FED-006 — Docs, Docker, end-to-end.** `docs/FEDERATION.md` (deployment topologies,
   env matrix, failover runbook), docker-compose examples (central + 2 edges), CHANGELOG,
   E2E script `tests/federation/e2e.mjs` (3 instances: standalone→linked→kill central→
   degraded serving→recover→reconcile). Regression baseline re-run green.

## 6. Risks & Mitigations

1. **Secret exfiltration at edges (HIGH)** — providerConnections.data + apiKeys carry
   real keys. Mitigate: dedicated FEDERATION_TOKEN, TLS required, optional
   `FEDERATION_REDACT_FIELDS` (document: redacted edges lose full DEGRADED serving for
   those providers), JWT/API_KEY_SECRET sharing policy documented + mismatch warning in
   `/api/federation/status`.
2. **Split-brain / two writers (HIGH)** — single central by design; DB-layer write-guard
   on replicated rows while LINKED; degraded writes only to pendingWrites; fencing lease;
   no self-promotion.
3. **Schema drift (HIGH)** — schemaVersion advertised in verify/snapshot; SCHEMA_BLOCKED
   pauses apply with upgrade banner; never partial-apply.
4. **Thundering herd on recovery (MED)** — ±20% jitter on outage threshold + reconnect
   backoff; replay batches bounded.
5. **UX confusion (LOW)** — clear status banner + degraded-mode response headers;
   dashboard never silently lies about write commitment.

## 7. Done Criteria (GitReins judge)

Each phase task completes only when: code + additive tests land; `verify-no-regression`
gate green (or known-fails only); `FEDERATION_MODE` unset behaves identically to baseline;
docs updated; commit on `federation` branch. Final PR: `totalwindupflightsystems/9router:federation`
→ `decolua/9router:master` with docs/FEDERATION.md + E2E evidence.
