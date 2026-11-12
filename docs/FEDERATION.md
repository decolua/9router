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
| **central** | `central` | Single authoritative writer. Serves its own dashboard, `/v1` pipeline and the federation API (`/api/federation/{config-status,local-status,delta,replay,snapshot,status,verify}`). Every write to a replicated table stamps a monotonically increasing `federation_version`. |
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

> **Where the secrets live in Docker:** `docker-compose.federation.yml` does
> not bake in the shared secrets — it reads `FEDERATION_TOKEN`,
> `JWT_SECRET`, `API_KEY_SECRET` and `INITIAL_PASSWORD` from `.env` via
> `env_file` on the `x-federation-common` anchor (inherited by
> central/edge-a/edge-b). Create `.env` from the tracked example
> (`cp .env.example .env`), then edit the values. `.env` is gitignored and
> never committed.

### 3.1 Non-federation vars that matter

| Var | Sharing policy |
|---|---|
| `DATA_DIR` | Per-instance (each instance has its own SQLite replica). In Docker, one volume per instance. |
| `PORT` | Per-instance (each instance listens on its own port). |
| `JWT_SECRET` | **Share across all instances.** Dashboard sessions are signed with it; a mismatched secret makes the dashboard on one instance reject sessions issued by another. |
| `API_KEY_SECRET` | **Share across all instances.** API keys are derived from it; a mismatch makes `/v1` keys issued on central invalid on edges (and vice versa). It is a server-side HMAC/signing secret only — minted `sk-…` client keys are what remote callers send; the secret itself is never a valid client credential. |
| `INITIAL_PASSWORD` | Share if you want the same first-login password everywhere. |
| `MACHINE_ID_SALT` | Share if machine-id-derived values (e.g. default `FEDERATION_EDGE_ID`) must be stable across instances. |
| `BASE_URL` / `NEXT_PUBLIC_BASE_URL` | Per-instance public URL (used by internal sync jobs / UI links). |

> **Remote `/v1` calls need an API key.** The public LLM API prefixes
> (`/v1`, `/v1beta`, `/api/v1`, `/api/v1beta`, `/codex`, `/responses` — `PUBLIC_PREFIXES` in
> `src/dashboardGuard.js`) are public at the *dashboard* layer but authenticate
> separately: a request from a non-loopback peer with no valid key gets
> `401 {"error":{"message":"API key required for remote API access","type":"authentication_error","code":"invalid_api_key"}}` unless the effective
> `requireApiKey` setting is exactly `false` (set `REQUIRE_API_KEY=false` — the
> `.env.example` default, honored on remote routes since QA-9ROUTER-5). Keys are
> derived from `API_KEY_SECRET` above, so **one key works on central and on
> every edge**. "Remote" here means any caller that is not loopback as seen by
> the instance — including a `curl` from the host into a published container
> port (`§5.2`, `§6.1`). See `docs/api-reference.md` for the two auth surfaces
> and the login + `POST /api/keys` recipe.

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

Put the same value in every instance's env — in Docker, `.env` (the compose
file reads it via `env_file`; `cp .env.example .env` to get started), or the
orchestrator's secret store on bare metal. The token is compared in constant
time (SHA-256 pre-hash) and never appears in dashboard responses — the
config page only reports "configured yes/no".

**Minimum length (NR-GAP-034):** a configured `FEDERATION_TOKEN` shorter
than 16 characters is treated like a placeholder at boot — flagged by the
same `[security]` gate as the `change-me-*` example values. A federation-mode
boot (central or edge) with a short token **refuses to start** (FATAL +
exit 1); standalone keeps warning-only. Use ≥ 16 chars (prefer 32+, e.g.
`openssl rand -hex 32`). See §6.5 for rotation.

---

## 4. Replication model

### Federation API routes

The federation API has these seven registered handlers. `GET /api/federation/config-status`
is a **token-less, read-only** local configuration surface for an instance's
own dashboard config page. It returns local configuration metadata only (the
federation token is reported only as configured yes/no and never leaves the
server). Its CORS preflight, `OPTIONS /api/federation/config-status`, returns
`204 No Content`.

| Endpoint | Purpose | Access |
|---|---|---|
| `GET /api/federation/config-status` | Local federation configuration metadata for the dashboard config page | Token-less, read-only; `OPTIONS` returns `204` |
| `GET /api/federation/local-status` | Local edge lifecycle and replica status | Token-less local dashboard status |
| `GET /api/federation/delta?since=<revision>` | Replication changes since a watermark | `FEDERATION_TOKEN` |
| `POST /api/federation/replay` | Replay a queued edge write | `FEDERATION_TOKEN` + fencing material |
| `GET /api/federation/snapshot?since=0` | Bootstrap snapshot | `FEDERATION_TOKEN` |
| `GET /api/federation/status` | Central/edge diagnostic status | `FEDERATION_TOKEN` |
| `GET /api/federation/verify` | Heartbeat and lease renewal | `FEDERATION_TOKEN` |

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

### 4.1 Status surface semantics (FED-016)

Both `GET /api/federation/status` (guarded, central + edge) and
`GET /api/federation/local-status` (token-less, edge dashboard) return the
same payload from `buildLocalStatusPayload`. Semantics:

| Field | Meaning |
|---|---|
| `role` | `central` \| `edge` \| `standalone` |
| `lastAppliedRevision` | The edge's replication watermark. **`null` means the instance has never applied a replica** (loops never started, or a central/standalone instance that has no replica) — it is *not* the same as `0`. |
| `maxVersion` | Central watermark of the local DB (highest `federation_version`). |
| `revisionLag` | **Edge-only.** `maxVersion - lastAppliedRevision` (clamped ≥ 0). Central and standalone report `0` + a `revisionLagNote` — central is the source of truth and has no replica to lag; a self-lag number there was misleading. |
| `last_state` | **Edge-only.** `linked` \| `degraded` \| `recovering` from the failover state machine — or **`uninitialized`** when the runtime has recorded no lifecycle activity. Migration 002 seeds an empty `federation_meta` row (all columns NULL); `role`/`last_state`/`lastAppliedRevision` are only written by the runtime (replication loop on its first tick, failover on state change), so an all-NULL row means the loops never started — previously this reported `linked`, which masked a dead edge during the 2026-08-08 dogfood diagnosis. |
| `initialized` | **Edge-only.** `true` when any lifecycle field (`role`, `last_state`, `lastAppliedRevision`) has been written; the machine-readable twin of `last_state`'s `uninitialized` vs real-state distinction. |

A misconfigured edge (missing `FEDERATION_MODE=edge`, wrapper not booted, or
federation modules absent from the image) now shows `"last_state":
"uninitialized"` and a grey/blue "Federation uninitialized" banner instead
of a false green "Federation linked".

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

#### 5.1.1 The pre-DEGRADED window fails open when the replica is fresh

Between central's death and the DEGRADED flip (step 2 above), the edge is
still LINKED, so `/v1` traffic is still being forwarded — and every forward
fails. Answering a hard `502 {"error":{"code":"FED_UPSTREAM_ERROR"}}` in that
window is needless when the edge already holds a current replica.

When all of the following hold, the edge serves the request from its **local
replica** instead, with `X-Federation-State: degraded` — the same serving path
and the same header the post-flip DEGRADED state uses:

- central is **unreachable before the request body was sent** (connection
  refused / DNS / connect timeout — the failure mode of a killed or
  partitioned central); and
- the request is a `/v1/*` request; and
- the local replica is **fresh**: `federation_meta` shows runtime activity
  (`role`/`last_state`/`lastAppliedRevision` written) **and** a central
  watermark was advertised (`centralMaxVersion` is not NULL) **and**
  `revisionLag == 0`.

It logs `[federation] edge proxy: upstream <METHOD> <PATH> failed before the
request body was sent; serving from the fresh local replica (state 'linked').`

**This is not a new state.** Nothing in the window writes `last_state`: the
LINKED → DEGRADED transition is still owned by the heartbeat threshold and by
the proxy's failover hook (which fires on the same failure). The window only
decides *how to answer one request* while the machine catches up — the same
decision the DEGRADED state makes, one step earlier. The replica freshness
numbers are read from the same `federation_meta` columns `local-status`
reports, so the banner and the serving decision can never disagree.

**The window stays fail-hard — by design — whenever serving locally would not
be equivalent to serving centrally:**

| condition | behavior | why |
|---|---|---|
| replica behind central (`revisionLag > 0`) | `502 FED_UPSTREAM_ERROR` | the replica is missing writes; answering from it would serve stale config |
| replica never synced (`centralMaxVersion` NULL) | `502 FED_UPSTREAM_ERROR` | no baseline — lag is *unknown*, not zero |
| runtime never started (`federation_meta` all-NULL) | `502 FED_UPSTREAM_ERROR` | there is no replica |
| failure **after** connect (central accepted, then reset) | `502 FED_UPSTREAM_ERROR` | the client body was already consumed, so a local retry would read an empty body |
| mutating dashboard write (`POST /api/settings`, …) | `502 FED_UPSTREAM_ERROR` | `/v1` is a read against the replica; applying a write locally while LINKED would skip `pendingWrites` and never replay. Retry after the flip → the write is queued exactly once |

Once the flip lands (within the threshold), the ordinary §5.2 degraded path
takes over for everything, including writes.

**Verify** (token-less, local only — the payload never carries the token, the
lease/fencing material or any central data):

```bash
# Host → edge-a's published port (the default 20129; see §6.1 for the port
# override variables when the stack runs alongside another 9router):
curl http://localhost:20129/api/federation/local-status
# → "role":"edge" … "last_state":"degraded"

# From inside the stack's network (federation_net) the same call is:
#   curl http://edge-a:20128/api/federation/local-status
# NOTE: the compose services are `central` / `edge-a` / `edge-b` — `edge`
# alone is not a hostname anywhere in the stack.
```

### 5.2 Degraded serving

- `/v1/*` is served from the local replica through the unchanged chat
  pipeline (accounts, combos, keys, aliases read from local tables).
- Dashboard reads resolve from the local replica; those **dashboard API** reads
  carry `X-Federation-State: degraded`. The header is a dashboard-data signal,
  not a transport signal: `/v1/*` responses do not carry it
  (`src/lib/federation/proxy.js` → `isDashboardApiPath`).
- Mutating dashboard API calls are queued to `pendingWrites` and respond
  `202 Accepted` with `X-Federation-State: degraded` +
  `X-Federation-Queued-Write-Id`. When the queue is full
  (`FEDERATION_QUEUE_MAX`), new writes get `503`.
- The dashboard banner shows DEGRADED (red) + revision lag.

**Verify** (the live calls target edge-a — from the host use its published port,
default 20129, or your override from §6.1; from inside `federation_net` use
`http://edge-a:20128`):

```bash
# a) The edge's own state, token-less (§5.1):
curl http://localhost:20129/api/federation/local-status
# → "last_state":"degraded"

# b) /v1 keeps serving from the local replica. /v1 is a REMOTE API surface:
#    a non-loopback caller with no valid key gets
#    401 {"error":{"message":"API key required for remote API access",
#    "type":"authentication_error","code":"invalid_api_key"}}.
#    Prerequisite — create ONE key (dashboard → Endpoint → API Keys, or the
#    login + POST /api/keys recipe in docs/api-reference.md) and use it
#    everywhere: keys are derived from the shared API_KEY_SECRET (§3), so
#    central and both edges accept the same key.
KEY=sk-...   # a key created on central or on any edge
curl -i http://localhost:20129/v1/models -H "Authorization: Bearer $KEY"
# → 200, the model list built from edge-a's LOCAL replica:
#   {"object":"list","data":[{"id":"<model>","object":"model",...}, ...]}
#   While DEGRADED nothing proxies upstream — the model aliases, providers and
#   combos come from the edge's replicated tables.
# Other key carriers are accepted too: `x-api-key: $KEY`, `x-goog-api-key: $KEY`
# or `?key=$KEY` (src/dashboardGuard.js → extractApiKey).

# c) Keyless alternative: an instance running with requireApiKey: false
#    (REQUIRE_API_KEY=false — the .env.example default, honored on remote
#    routes since QA-9ROUTER-5) accepts (b) with no key header at all.
#    If your install still 401s here, you are in the keyed case — or the
#    running image predates that fix; rebuild it.
```

> The `source: local-replica` marker comes from the federation E2E harness
> (`tests/federation/e2e.mjs`, which boots three stand-in instances) — the
> production `/v1` routes return the standard provider shape shown above, and
> the degraded-state proof is the `local-status` call in (a).

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
| Edge reports `"last_state": "uninitialized"` (never-started) | Federation loops never started: `FEDERATION_MODE=edge` missing at boot, the custom-server wrapper didn't boot, or the federation modules are absent from the image. Check logs for `[federation] replication + failover loops started`; an edge that is actually running flips to `linked`/`degraded` within seconds. |
| `npm run dev` / `next dev` with `FEDERATION_MODE=edge` exits FATAL | **Expected (FED-018).** The edge proxy + DEGRADED intercept live only in `custom-server.js`, which the Next.js dev server never loads — a dev-mode edge would silently serve zero federation behavior. Use the production path: `npm run build && npm start` (or `docker compose -p 9router-federation -f docker-compose.federation.yml up`). Central/standalone dev is unaffected. |
| Edge stays LINKED but `/v1` 502s | `FEDERATION_CENTRAL_URL` unreachable from the edge (firewall, DNS, TLS). Check `curl https://central/api/federation/verify` with the token. |
| **`/api/federation/status` (or any federation API call) 401s with your own token** | Two causes, in this order. **(1) You are not talking to the compose central** — something else already serves that host port (an existing 9router install, a stale stack), so its `FEDERATION_TOKEN` is a different secret and every call 401s while the container you meant to hit is fine. Check what is published (`docker compose -p 9router-federation -f docker-compose.federation.yml ps`) and what is actually listening (`ss -tlnp \| grep <port>`), then either re-run the stack on override ports (§6.1) or stop the other instance. **(2) The container was booted with a different `FEDERATION_TOKEN` than your shell's** — compare `docker compose -p 9router-federation -f docker-compose.federation.yml exec central printenv FEDERATION_TOKEN` with `$FEDERATION_TOKEN`; fix `.env` and `docker compose -p 9router-federation -f docker-compose.federation.yml up -d` again (a re-`up` recreates the containers with the corrected value). Only after both are ruled out is regenerating the token (§6.5) the fix. |
| `curl: (6) Could not resolve host: edge` | There is no `edge` service. The compose services are `central` / `edge-a` / `edge-b`: from the host use `localhost:<published port>` (defaults 20128 / 20129 / 20130), from inside `federation_net` use `http://edge-a:20128`. |
| `/v1` 401 `{"error":{"message":"API key required for remote API access","type":"authentication_error","code":"invalid_api_key"}}` | The caller is remote (not loopback as the instance sees it) and presented no valid API key. Create one (dashboard → Endpoint → API Keys, or the login + `POST /api/keys` recipe in `docs/api-reference.md`) and send it as `Authorization: Bearer <key>`, `x-api-key`, `x-goog-api-key` or `?key=` — a key from any instance works on all of them (§3 shares `API_KEY_SECRET` — that shared secret is what makes minted keys portable; the secret itself is not a client key). Only `requireApiKey: false` (`REQUIRE_API_KEY=false`) allows the remote call keyless. See §5.2. |
| Dashboard sessions break across instances | `JWT_SECRET` mismatch. |
| `/v1` keys invalid on edges | `API_KEY_SECRET` mismatch (keys are derived from it). Note `API_KEY_SECRET` itself is a server-side signing secret, never a client key — see §3.1. |
| Edge never catches up (`revisionLag` grows) | `FEDERATION_SYNC_INTERVAL_MS` too high, or central overloaded. Check central logs for slow delta builds. |
| `SCHEMA_BLOCKED` (see below) | Edge migration version < central's. Upgrade the edge image. |
| Writes marked `failed` in the queue | Replay 409'd twice (stale fence) or 4xx. Check `pendingWrites.last_error` via diagnostics. |
| Edges flip DEGRADED too eagerly | Raise `FEDERATION_OUTAGE_THRESHOLD_MS` (and/or heartbeat interval). |
| Edges flip DEGRADED too slowly | Lower `FEDERATION_OUTAGE_THRESHOLD_MS`; or rely on the immediate proxy-502 flip. |

---

## 6. Operations

### 6.1 Docker (example compose)

> **Set the secrets in `.env` first.** `docker-compose.federation.yml` does
> not bake in secrets — it reads the four shared secrets
> (`FEDERATION_TOKEN`, `JWT_SECRET`, `API_KEY_SECRET`, `INITIAL_PASSWORD`)
> from `.env` via `env_file` (on the `x-federation-common` anchor, so
> central/edge-a/edge-b all inherit it). A federation-mode boot (the
> `central`/`edge` services) with placeholder values still in place REFUSES
> to start with a loud `[security] FATAL` error and exit code 1 — replace
> them before any real deployment, or the instance is trivially compromised
> beyond localhost. (Standalone quickstarts, `FEDERATION_MODE` unset, still
> boot with a prominent warning — localhost-only testing only.)

```bash
# 1. Create .env from the tracked example and fill in real values. All four
#    must be long, random values; FEDERATION_TOKEN (and ideally all four)
#    must be identical on every instance:
#      FEDERATION_TOKEN:  <long random token, shared edge↔central>
#      JWT_SECRET:        <long random string>
#      API_KEY_SECRET:    <long random string>
#      INITIAL_PASSWORD:  <dashboard login password>
cp .env.example .env
$EDITOR .env   # replace the placeholder values (never commit .env)

# 2. Build + start central + 2 edges:
docker compose -p 9router-federation -f docker-compose.federation.yml up -d --build

# Check status (these curls assume the DEFAULT published ports below; if you
# override them — see "Running alongside an existing 9router" — substitute your
# values, e.g. 21128 / 21129 / 21130):
docker compose -p 9router-federation -f docker-compose.federation.yml ps
curl http://localhost:20128/api/federation/status -H "Authorization: Bearer $FEDERATION_TOKEN"
curl http://localhost:20129/api/federation/local-status   # edge-a
curl http://localhost:20130/api/federation/local-status   # edge-b

# Simulate a central outage:
docker compose -p 9router-federation -f docker-compose.federation.yml stop central
# ...edges flip DEGRADED after the threshold; /v1 keeps working on 20129/20130
# (with an API key — see §5.2)...

# Recover:
docker compose -p 9router-federation -f docker-compose.federation.yml start central
# ...edges drain + catch up + return to LINKED...
```

The example uses `Dockerfile.federation` (the standalone Dockerfile plus the
`src/` tree and `@/` alias the federation runtime modules need — Next's file
tracing does not follow custom-server.js's dynamic imports). If you publish
a federation image, swap `build:` for `image:`.

#### Running alongside an existing 9router

The example's container names and published host ports are overridable, so the
stack can run on a host that already serves 9router on 20128 (or that already
runs this example stack) without a port collision:

| Variable | Default | Effect |
|---|---|---|
| `FEDERATION_STACK_PREFIX` | `9router` | container names: `${PREFIX}-central`, `-edge-a`, `-edge-b` |
| `FEDERATION_CENTRAL_PORT` | `20128` | central's published host port |
| `FEDERATION_EDGE_A_PORT` | `20129` | edge-a's published host port |
| `FEDERATION_EDGE_B_PORT` | `20130` | edge-b's published host port |

```bash
# Same stack, non-colliding names + host ports:
FEDERATION_STACK_PREFIX=9r-fed \
FEDERATION_CENTRAL_PORT=21128 \
FEDERATION_EDGE_A_PORT=21129 \
FEDERATION_EDGE_B_PORT=21130 \
docker compose -p 9router-federation -f docker-compose.federation.yml up -d --build
```

Only the **host** side moves. The container-side port is 20128 on all three
instances and `FEDERATION_CENTRAL_URL` stays `http://central:20128` (a service
name + container port inside `federation_net`), so replication and proxying are
unaffected by a host-port override. Use `-p 9router-federation` on **every**
federation Compose command (for example, `docker compose -p 9router-federation
-f docker-compose.federation.yml up -d --build`). The explicit project isolates
this stack's Compose network and named volumes from an existing stack; without
it, the same checkout can resolve the existing project's network and data
volumes instead.

The federation file's `central-data`, `edge-a-data`, and `edge-b-data` volumes
are project-scoped. This does **not** isolate the standalone
`docker-compose.yml` volume: that file explicitly pins `9router-data` globally,
so a second standalone deployment needs a separately named data volume rather
than relying on `-p`.

Then run the status checks against the overridden ports:

```bash
curl http://localhost:21128/api/federation/status -H "Authorization: Bearer $FEDERATION_TOKEN"
curl http://localhost:21129/api/federation/local-status   # edge-a
```

**If that first curl 401s with your own token, determine which server answered
before touching the token.** `docker compose -p 9router-federation -f docker-compose.federation.yml ps`
shows the ports the stack actually published, and `ss -tlnp | grep <port>` shows
every listener on them; a port owned by an existing 9router (or any other
process) means your request never reached the compose central — re-run the stack
on override ports or stop the other instance (§5.5). If the stack does own the
port, the second cause is a token mismatch: compare
`docker compose -p 9router-federation -f docker-compose.federation.yml exec central printenv FEDERATION_TOKEN`
with your shell's `$FEDERATION_TOKEN`, fix `.env`, then `up -d` again.

> ⚠️ Do **not** start this example stack with `up` on a host whose 20128 is
> already served by a live 9router: the `central` service publishes `20128:20128`
> by default and the bind fails (or, worse, you end up probing the other
> instance and blaming the token). Start with the overrides above, or stop the
> other instance first.

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

### 6.5 Rotating secrets

Rotation matters: any secret that may have leaked (a compromised instance,
a token in a log/commit/chat, a departed operator with access to the env)
must be replaced — the federation API is gated only by `FEDERATION_TOKEN`,
so a leaked token lets anyone read the full config snapshot and push
replays. The boot gate (NR-GAP-019/034) refuses to start with `change-me-*`
placeholders or a `FEDERATION_TOKEN` shorter than 16 chars, but it cannot
detect a *leaked* long token — only rotation fixes that.

**`FEDERATION_TOKEN`** (shared by all instances):

1. Generate a new long random value: `openssl rand -hex 32` (64 chars).
2. Update **every** instance's env / compose `environment:` / secret store
   with the new value — all edges AND central must agree.
3. Restart **edges first, then central** (same order as §6.6 upgrades).
   Brief auth-window tradeoff: if you restart central first, edges keep
   presenting the old token and get 401s until they are restarted too —
   either order works as long as all instances are updated before the
   last one restarts; edges-first minimizes the window where a stale edge
   is rejected.

**`JWT_SECRET`** (dashboard session signing): rotating it invalidates all
existing dashboard sessions — users simply re-login. No data loss; do it
when you suspect session-cookie forgery or as part of a general secret
sweep. Restart the instance after changing it.

**`API_KEY_SECRET`** (API-key signing/verification): rotating it invalidates
all issued API keys — re-issue keys to clients after the change (the
dashboard API-key page). Restart the instance after changing it.

**`INITIAL_PASSWORD`** (dashboard admin password): change it in the
dashboard (or env for fresh setups) — existing sessions stay valid until
re-login. Use a password manager; never reuse it across instances.

**Minimum-length rule:** `FEDERATION_TOKEN` must be ≥ 16 chars (prefer 32+,
e.g. `openssl rand -hex 32`); a shorter configured token is rejected at
boot in federation mode (NR-GAP-034). The other secrets have no length
gate, but use long random values for all of them.

### 6.6 Upgrades

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
(cd tests && ./node_modules/.bin/vitest run --reporter=json --outputFile=/tmp/results.json)
node tests/__baseline__/verify-no-regression.mjs /tmp/results.json
```

Both lines are repo-root relative and safe to paste into one shell: the subshell
returns to the repo root even though the run ends red by design (exit 1) — the
verify step is the gate. The vitest binary must be the `tests/`-local pinned one.

`tests/` is its own npm package, so run `cd tests && npm install` once before the
first run — that installs the pinned vitest into `tests/node_modules`.

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
