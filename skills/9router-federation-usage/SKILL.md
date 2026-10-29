---
name: 9router-federation-usage
description: >-
  How to deploy, configure, and VERIFY the 9router federation feature (edge ->
  central proxying + SQLite replication + failover) in this fork. Use when a
  task involves federation: booting central/edge instances, the FEDERATION_*
  env vars, the /api/federation/* protocol, or verifying the failover
  lifecycle. Includes the verified real-boot recipe (repo-root production
  path), the dashboard API quick reference, the acceptance checks, and the
  known pitfalls (stream-mode mock caveat, minor API quirks) so agents don't
  re-discover them.
version: 3.0.0
---

# 9router federation — usage skill (fork)

This fork's federation feature: deploy the same 9router gateway on many hosts;
edges proxy `/v1` + mutating dashboard API to a central instance, replicate its
SQLite config DB, and serve from the local replica if central dies (writes
queued during an outage, replayed on recovery).

**Status (re-verified 2026-09-19 dogfood, real deployment @ 585bd31c): the
feature WORKS end-to-end and all known integrity findings are FIXED.**
Acceptance checks A–D pass: replication converges (<7s), client API keys
authenticate through the edge, the federation API answers Bearer-only, and the
full kill-central → DEGRADED → serve-from-replica → queued-write → restart →
drain → reconcile lifecycle completes. FED-020 (delta rows lose version
metadata) and FED-022 (settings never replicate via delta) were re-verified at
ROW LEVEL and both hold fixed. Don't trust "federation works" claims — run the
acceptance checks; they take ~10 minutes.

## Key facts

- Env: `FEDERATION_MODE=standalone|central|edge` (default standalone = inert).
  Edge also needs `FEDERATION_CENTRAL_URL` + `FEDERATION_TOKEN`; share
  `JWT_SECRET`/`API_KEY_SECRET`/`INITIAL_PASSWORD` across instances (mismatch =
  "everything links but nothing works"). Defaults in
  `src/lib/federation/config.js` + `constants.js`; documented in
  `docs/FEDERATION.md` (deployment guide) + `docs/federation-spec.md` (design).
- Modules: `src/lib/federation/{config,constants,edgeClient,failover,proxy,
  queue,replication,roleGuard,server,state,stamp,headers,statusView,
  startLoops}.js`.
- The edge proxy/DEGRADED intercept runs inside `custom-server.js` — and
  **`npm run start` boots it** (FED-014). `npm run dev` with
  `FEDERATION_MODE=edge` exits FATAL by design (FED-018) — use the production
  path for edges.
- Loops start from real entry points (FED-013): an edge logs
  `[federation] replication + failover loops started (edge mode).` at boot.
- Central federation API: `/api/federation/{snapshot,delta,verify,status,replay}`
  with `Authorization: Bearer <FEDERATION_TOKEN>` (no cookies needed — FED-012
  fixed); `local-status` + `config-status` are token-less, local only.
- Replica DB: `<DATA_DIR>/db/data.sqlite` (WAL, better-sqlite3 → sql.js
  fallback). Usage tables stay host-local by design.
- Boot guards: federation-mode boots REFUSE to start (FATAL) with placeholder
  secrets (NR-GAP-019) or a `FEDERATION_TOKEN` shorter than 16 chars
  (NR-GAP-034). Set real values first.

## Boot a real central + edge (verified 2026-09-01 recipe)

The **repo-root production path works as-is** — no Docker-layout assembly:

```bash
# 1. build once (lockfiles are tracked; npm ci reproduces the install)
npm ci && npm run build   # postbuild copies custom-server.js into .next/standalone

# 2. central (port 20131, fresh DATA_DIR)
cd ~/9router
NODE_ENV=production HOSTNAME=127.0.0.1 PORT=20131 DATA_DIR=/tmp/fed-central \
JWT_SECRET=<shared> API_KEY_SECRET=<shared> INITIAL_PASSWORD=<pass> \
FEDERATION_TOKEN=<shared-token-16+chars> FEDERATION_MODE=central FEDERATION_EDGE_ID=central \
node custom-server.js

# 3. edge (port 20132, fresh DATA_DIR, fast intervals for testing)
NODE_ENV=production HOSTNAME=127.0.0.1 PORT=20132 DATA_DIR=/tmp/fed-edge \
JWT_SECRET=<same> API_KEY_SECRET=<same> INITIAL_PASSWORD=<same> \
FEDERATION_TOKEN=<same-token> FEDERATION_MODE=edge FEDERATION_EDGE_ID=edge \
FEDERATION_CENTRAL_URL=http://127.0.0.1:20131 \
FEDERATION_SYNC_INTERVAL_MS=2000 FEDERATION_HEARTBEAT_INTERVAL_MS=1000 \
FEDERATION_OUTAGE_THRESHOLD_MS=5000 \
node custom-server.js
```

Edge boot must show `[federation] replication + failover loops started (edge mode).`
If not, federation is not running (check FEDERATION_MODE / wrapper / image).

To get real `/v1` traffic without external credentials: create an `ollama-local`
provider pointing at any mock OpenAI/Ollama-compatible server, then call
`/v1/chat/completions` with model `ollama-local/<model>` (the provider prefix is
required). A working mock is at `/tmp/dogfood-9router-r3/mock-ollama.mjs`
(`POST /api/chat`, `GET /api/tags`, port 11439).

## Dashboard API quick reference

```bash
curl -c cookies -X POST http://HOST:PORT/api/auth/login -H 'Content-Type: application/json' \
  -d '{"password":"<INITIAL_PASSWORD>"}'          # session cookie
curl -b cookies -X POST http://HOST:PORT/api/keys -H 'Content-Type: application/json' \
  -d '{"name":"my-key"}'                           # -> {"key":"sk-...","machineId": ...}
curl -b cookies -X POST http://HOST:PORT/api/providers -H 'Content-Type: application/json' \
  -d '{"provider":"ollama-local","name":"mock","providerSpecificData":{"baseUrl":"http://127.0.0.1:11439"}}'
# Combos (fallback chains): create on central, call by combo NAME as the model
curl -b cookies -X POST http://HOST:PORT/api/combos -H 'Content-Type: application/json' \
  -d '{"name":"my-combo","models":["ollama-local/<model>"]}'
curl -s -X POST http://HOST:PORT/v1/chat/completions -H "Authorization: Bearer <key>" \
  -H 'Content-Type: application/json' \
  -d '{"model":"<combo-name>","stream":false,"messages":[{"role":"user","content":"ping"}]}'
# Settings writes replicate too (FED-022 fixed)
curl -b cookies -X PATCH http://HOST:PORT/api/settings -H 'Content-Type: application/json' -d '{"theme":"dark"}'
```

## Verifying federation (acceptance checks — run these, not the test suite)

```bash
# A. replication converges: edge local-status -> linked, revisionLag 0, and
#    lastAppliedRevision ADVANCES after central-side writes (check twice!)
curl -s http://EDGE:PORT/api/federation/local-status   # token-less
# A+. row-level integrity (FED-020 regression): after a delta update, compare
#    versions central vs edge — they must MATCH (this caught the 08-20 bug):
#    SELECT name, federation_version, updated_at FROM apiKeys  (both DBs)
# B. authenticated /v1 through the edge (must be 200, NOT "Invalid API key")
curl -s -X POST http://EDGE:PORT/v1/chat/completions -H "Authorization: Bearer <client-key>" \
  -H 'Content-Type: application/json' \
  -d '{"model":"ollama-local/<model>","stream":false,"messages":[{"role":"user","content":"ping"}]}'
# C. federation API, Bearer only, no cookies; wrong/no token must 401
curl -s http://CENTRAL:PORT/api/federation/status -H "Authorization: Bearer $FEDERATION_TOKEN"
# D. lifecycle: SIGKILL central -> edge flips degraded (~threshold ms) and /v1 STILL
#    200 (replica serving); queued write -> 202 + X-Federation-Queued-Write-Id;
#    restart central -> edge returns to linked (~15-20s), pendingWrites state=done,
#    central contains the queued row, and it replicated back to the edge.
```

## Pitfalls (learned the hard way)

- **The e2e harness (`tests/federation/e2e.mjs`) is NOT a product test** — it
  spawns its own instances. The real-boot recipe above is the honest
  verification.
- **Streaming with the mock upstream fails** (`503 Provider error (reset after
  15s)`) — identical on central and edge, so NOT federation-specific; the
  mock's non-compliant stream format. Always use `"stream":false` locally.
- **PUT `/api/keys/{id}` only supports `isActive`** — a `{"name":...}` body
  returns 200 and silently changes nothing (R3-01). There is no key-rename API.
- **Short-token boot guard logs the "placeholder secrets" wording** even when
  the token isn't an example value (R3-02) — the message is still a hard
  refusal; just read it as "your FEDERATION_TOKEN is bad".
- **During a central outage the edge logs `[federation] pull failed: fetch
  failed` once per sync interval** — expected until central returns (R3-03,
  rate-limiting suggested).
- **Wiring a local OpenAI-compatible endpoint (the two-object model).** The
  fast path is: (1) `POST /api/provider-nodes` with
  `{name, type:"openai-compatible", apiType:"chat", prefix, baseUrl}` — the
  node carries NO credential; (2) `POST /api/providers` with
  `{provider: <node.id from step 1>, apiKey, name}` — this is the credential
  that makes traffic flow. Skip step 2 and every request dies with
  `No active credentials for provider: openai-compatible-chat-…`. If the
  upstream is genuinely Ollama-native (`/api/chat`), use
  `provider:"ollama-local"` with `providerSpecificData.baseUrl` instead —
  pointing `ollama-local` at an OpenAI-shaped server gives a silent empty 200.
- Model IDs on /v1 need the provider prefix (`ollama-local/<model>`), or a
  combo name (no prefix). For openai-compatible nodes the prefix is the one
  YOU defined on the node.
- Never reuse `FEDERATION_TOKEN` for `JWT_SECRET`/`API_KEY_SECRET`; do share
  the latter two across instances.
- Historical context: FED-011..016 (dead proxy/auth/loops), FED-020 (delta
  version drop), FED-021 (lag metric), FED-022 (settings) are all FIXED and
  re-verified — see `docs/dogfood/` for the run history. If any acceptance
  check fails at a future HEAD, check the row-level integrity probe (A+)
  first: it is the most sensitive canary for replication regressions.
