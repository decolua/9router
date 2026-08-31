---
name: 9router-federation-usage
description: >-
  How to deploy, configure, and TEST the 9router federation feature (edge ->
  central proxying + SQLite replication + failover) in this fork. Use when a
  task involves federation: booting central/edge instances, the FEDERATION_*
  env vars, the /api/federation/* protocol, or verifying the failover
  lifecycle. Includes the real-boot recipe (Dockerfile.federation layout) and
  the known-broken paths (FED-011..FED-016) so agents don't waste time.
version: 1.0.0
---

# 9router federation — usage skill (fork)

This fork's federation feature: deploy the same 9router gateway on many hosts;
edges proxy `/v1` + mutating dashboard API to a central instance, replicate its
SQLite config DB, and serve from the local replica if central dies.

**WARNING (2026-08-08 dogfood): the feature is 🔴 DOES-NOT-DELIVER in real
deployments.** Board FED-011..FED-016 are the known breaks. Don't trust
"federation works" — verify with the acceptance checks below. The unit tests
and `tests/federation/e2e.mjs` PASS while the real app does nothing (the e2e
harness starts the loops itself and bypasses the dashboard guard).

## Key facts

- Env: `FEDERATION_MODE=standalone|central|edge` (default standalone = inert).
  Edge also needs `FEDERATION_CENTRAL_URL` + `FEDERATION_TOKEN`; share
  `JWT_SECRET`/`API_KEY_SECRET` across instances. Defaults in
  `src/lib/federation/config.js` + `constants.js`, documented in
  `docs/federation-spec.md` §4 and `docs/FEDERATION.md`.
- Modules: `src/lib/federation/{config,constants,edgeClient,failover,proxy,
  queue,replication,roleGuard,server,state,stamp,headers,statusView}.js`.
- The proxy/DEGRADED intercept ONLY runs inside `custom-server.js` (the Docker
  CMD). `npm run start`/`next start` does NOT load it.
- Central federation API: `/api/federation/{snapshot,delta,verify,status,replay}`
  (Bearer token), `local-status` + `config-status` (token-less). **All of them
  currently 401 via dashboardGuard unless you also send a dashboard session
  cookie** (FED-012).

## Boot a real central + edge (the dogfood repro recipe)

The containers run: standalone build + `custom-server.js` + `open-sse` + `src/`
+ `node_modules/@` symlink → `src` (see `Dockerfile.federation`). To boot from
the repo without Docker:

```bash
# 1. build once
npm run build    # produces .next/standalone
# 2. assemble the runtime layout
APP=/tmp/fed-app; mkdir -p $APP
cp -r .next/standalone/. $APP/ && cp custom-server.js $APP/
cp -r open-sse $APP/ && cp -r src $APP/
ln -sfn $APP/src $APP/node_modules/@
# 3. run instances (separate DATA_DIR + PORT each, shared secrets)
cd $APP
DATA_DIR=/tmp/fed-central JWT_SECRET=s JWT_API_KEY_SECRET=k INITIAL_PASSWORD=p \
FEDERATION_MODE=central FEDERATION_TOKEN=t PORT=20131 HOSTNAME=127.0.0.1 \
  node custom-server.js
DATA_DIR=/tmp/fed-edge FEDERATION_MODE=edge FEDERATION_CENTRAL_URL=http://127.0.0.1:20131 \
FEDERATION_TOKEN=t FEDERATION_EDGE_ID=edge-a PORT=20132 HOSTNAME=127.0.0.1 \
FEDERATION_SYNC_INTERVAL_MS=2000 FEDERATION_HEARTBEAT_INTERVAL_MS=1000 \
FEDERATION_OUTAGE_THRESHOLD_MS=5000 \
  node custom-server.js
```

To get real `/v1` traffic without external credentials: create an
`ollama-local` provider pointing at any mock OpenAI/Ollama-compatible server
(`POST /api/providers` with `providerSpecificData.baseUrl`), then call
`/v1/chat/completions` with model `ollama-local/<model>`.

## Dashboard API quick reference

```bash
curl -c cookies -X POST http://HOST:PORT/api/auth/login -H 'Content-Type: application/json' \
  -d '{"password":"<INITIAL_PASSWORD>"}'          # session cookie
curl -b cookies -X POST http://HOST:PORT/api/keys -H 'Content-Type: application/json' \
  -d '{"name":"my-key"}'                           # -> {"key":"sk-..."}
curl -b cookies -X POST http://HOST:PORT/api/providers -H 'Content-Type: application/json' \
  -d '{"provider":"ollama-local","name":"mock","providerSpecificData":{"baseUrl":"http://127.0.0.1:11439"}}'
```

## Verifying federation (acceptance checks)

```bash
# state + replication (needs cookie today — FED-012)
curl -s -b cookies http://EDGE:PORT/api/federation/local-status   # last_state, revisionLag
# replica contents (read-only):
node -e "const D=require('<app>/node_modules/better-sqlite3'); \
const db=new D('<DATA_DIR>/db/data.sqlite',{readonly:true}); \
console.log(db.prepare('SELECT COUNT(*) c FROM apiKeys').get())"
# proxied authenticated chat (must NOT say Invalid API key — FED-011)
curl -s -X POST http://EDGE:PORT/v1/chat/completions -H "Authorization: Bearer <client-key>" \
  -H 'Content-Type: application/json' -d '{"model":"ollama-local/<model>","messages":[{"role":"user","content":"ping"}]}'
# lifecycle: SIGKILL central -> edge flips degraded (works); restart central ->
# edge must return to linked + drain pendingWrites (BROKEN today — FED-013)
```

## Pitfalls (learned the hard way)

- The e2e harness is NOT a product test. Treat any "e2e PASS" claim as
  "modules work in isolation", then boot the real app and re-verify.
- `local-status` reporting `"linked"` does NOT mean replication runs — it's the
  default for an empty `federation_meta` row (FED-016).
- Replica DB is at `<DATA_DIR>/db/data.sqlite` (WAL). Usage stays host-local.
- The dashboard guard blocks `/api/federation/*` without a session cookie —
  curl with `-b cookies.txt` while FED-012 is open.
- Model IDs on /v1 need the provider prefix: `ollama-local/<model>`.
- Never reuse `FEDERATION_TOKEN` for `JWT_SECRET`/`API_KEY_SECRET`; do share
  the latter two across instances.
