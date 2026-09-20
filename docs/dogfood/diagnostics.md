# 9Router Federation — Diagnostics Trail (2026-08-08 dogfood)

_How the federation feature is built, what the dogfood run found, and the right way to
understand/fix it. Written by the 2026-08-08 dogfood run; board tasks FED-011..FED-016._

## 1. The architecture in one paragraph

9router is a Next.js 16 app (plain JS ESM, `@/*` → `src/*`) that fronts 40+ AI providers
with an OpenAI-compatible `/v1` API + dashboard. The federation fork adds three layers,
all gated on `FEDERATION_MODE` (default `standalone` = zero drift):

1. **DB layer** (`src/lib/federation/stamp.js`, migrations `00NN_federation*`): versioned
   config tables (`federation_version`, `updated_at`, `deleted` tombstones on the 8 config
   tables), `federation_meta` (role, edgeId, lastAppliedRevision, schemaVersion,
   leaseOwner/leaseExpiry, last_state, fencing_token), `pendingWrites`.
2. **Central API** (`src/lib/federation/server.js` + `src/app/api/federation/*` route
   wrappers): `snapshot`, `delta`, `verify`, `status`, `replay`, `local-status`,
   `config-status`, guarded by `src/lib/federation/roleGuard.js` (Bearer
   `FEDERATION_TOKEN`, SHA-256 pre-hash constant-time compare).
3. **Edge machinery** (`src/lib/federation/edgeClient.js` replication poll,
   `failover.js` heartbeat/state machine, `proxy.js` forwarding layer,
   `queue.js` degraded write queue) — wired into `custom-server.js`, which wraps
   `http.createServer` for the Next standalone server and sits **before** Next dispatch.

The forwarding decision is `proxy-up-by-default`: any request that matches `/v1/*` or a
mutating dashboard API path is proxied to central unless the edge is DEGRADED.

## 2. How the dogfood run found what it found

Reproduction-first, with real servers, in ~50 minutes:

- Assembled the exact `Dockerfile.federation` runtime layout in `/tmp` (standalone output
  + `custom-server.js` + `open-sse` + full `src/` + `node_modules/@` → `src` alias).
- Booted central (20131) + edge (20132) with `node custom-server.js` — the containers' CMD.
- Mock Ollama upstream (`/api/chat`, `/api/tags`) so real chat completions flowed.
- Watched the edge's replica DB (`better-sqlite3` read-only) and logs for ~6 minutes.
- Killed central with SIGKILL; watched state; restarted central; watched again.

## 3. Errors hit and their root causes (yours AND the project's)

| Error observed | Root cause | Task |
|---|---|---|
| `{"error":"Invalid API key"}` from central when proxying a valid client key via the edge | `buildUpstreamHeaders` moves `Authorization` → `X-9r-Client-Authorization`; central /v1 auth never reads it ("inert when absent"). Client key never reaches central's auth. | FED-011 |
| `{"error":"Unauthorized"}` on `/api/federation/status|verify|snapshot` with correct Bearer token; also on `local-status` with no auth | dashboardGuard (`src/proxy.js`) deny-by-default for `/api/*`; `/api/federation` missing from `PUBLIC_API_PATHS`. Guard runs before roleGuard. | FED-012 |
| Edge replica stays empty forever; `last_state` stays null; no log lines | `edgeClient.start()` / `failover.start()` never called outside the e2e harness. `custom-server.js` loads modules but never starts loops. | FED-013 |
| DEGRADED edge answers `/v1` with `Invalid API key` (replica empty) | consequence of FED-013 (no replication) — the failover machinery itself works (flip persisted `degraded`, queue accepted writes) | FED-013 |
| After central restart: edge stuck DEGRADED, `pendingWrites` never drain, central never reconciles | no heartbeat loop → nothing detects recovery (consequence of FED-013) | FED-013 |
| `npm run start` edge: no proxy at all, silently | `next start` doesn't load `custom-server.js`; only the Docker CMD does | FED-014 |
| Plain `Dockerfile` image edge: federation imports fail open, silently inert | image ships only `src/mitm`; Next tracing doesn't follow dynamic imports; only `Dockerfile.federation` copies `src/` | FED-015 |
| Central `/api/federation/status` shows `revisionLag: 3` on itself; `local-status` shows `linked` while nothing ever ran | status metrics computed naively; `last_state` defaults to LINKED on an empty meta row — masks "never started" | FED-016 |
| `mock-model-7b` → `No active credentials for provider: openai` | model IDs need the provider prefix (`ollama-local/mock-model-7b`); routing falls back to a default provider otherwise | (cosmetic, docs) |

## 4. The right way (what the fixes must look like)

1. **Start the loops where the process boots.** `custom-server.js`'s `listening` handler is
   the natural place (it already lazy-loads the modules): call `edgeClient.start()` +
   `failover.start()` there when `FEDERATION_MODE=edge`, with the env-driven intervals.
   `src/instrumentation.js` is the fallback for non-custom-server boots. The e2e harness
   should stop being the only starter.
2. **Make the guard pass the protocol through.** Add `/api/federation` (and
   `/api/federation/*`) to `PUBLIC_API_PATHS` in `src/dashboardGuard.js`. roleGuard already
   enforces the Bearer token with constant-time compare; `local-status`/`config-status` are
   intentionally token-less. This is the documented contract (FEDERATION.md §4/§5).
3. **Preserve client auth through the proxy.** Either central's /v1 auth falls back to
   `X-9r-Client-Authorization` when `Authorization` is the federation token, or the proxy
   keeps the client's `Authorization` and moves the federation token to a dedicated header
   (e.g. `X-Federation-Token`) that only central's federation API accepts. The latter is
   cleaner: `/v1` and dashboard API keep looking exactly like direct requests.
4. **Make inert loud.** A `FEDERATION_MODE=edge` boot without the modules (plain Docker
   image) or without the custom-server wrapper (`npm run start`) should print a clear
   error/warning naming the missing piece — never fail open silently.
5. **Fix the status surface.** `local-status` should report `uninitialized` when
   `lastAppliedRevision IS NULL`; central's `revisionLag` should not count its own writes.

## 5. How to verify the fixes (L3 acceptance — real use, not unit tests)

See the acceptance checks in `docs/dogfood/2026-08-08-integration.md`. Minimum: an edge
started via the documented Docker/README path converges its replica within ~15s, serves an
authenticated `/v1` completion through the proxy, flips DEGRADED on central death, still
serves from the replica, queues writes, and recovers + reconciles when central returns.

## 6. Why the e2e harness missed all of this

`tests/federation/e2e.mjs` + `e2e-child.mjs` build a **framework-free** node:http server
(`next/server` is not importable outside a Next build), start `edgeClient`/`failover`
**explicitly** (lines 262/266), and inline roleGuard semantics — so it never exercises:
custom-server.js wiring, dashboardGuard, the real route wrappers, or the real /v1 auth.
It proves modules, not product. Any future e2e must boot the real app (the dogfood repro
layout is the blueprint: standalone output + custom-server.js + src) and hit it over HTTP.
