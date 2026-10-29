---
name: 9router-compose
description: Deploy and operate 9router via docker compose — standalone, local-build fallback, and federation stacks. Verified live 2026-09-25 (dogfood run 15).
version: 1.0.0
---

# 9router compose deployment — the working recipe

Three compose paths exist. All verified live on 2026-09-25 at HEAD b9f1e162.

## The three paths

```bash
# 1. Standalone, published images (fastest; pulls decolua/9router + headroom)
docker compose -p myniner -f docker-compose.yml up -d

# 2. Local build (can't pull / offline / clean rootless host)
docker compose -p myniner -f docker-compose.yml -f docker-compose.local-build.yml \
  up -d --build --no-deps 9router

# 3. Federation (central + 2 edges, built from Dockerfile.federation)
docker compose -p myniner -f docker-compose.federation.yml up -d --build
```

## ALWAYS pass `-p <name>`

`FEDERATION_STACK_PREFIX` and the port variables rename CONTAINERS and move HOST
ports only. The compose PROJECT name comes from the directory (default `9router`)
and it owns the network and volume names. Without `-p`, a second stack silently
reuses the first stack's network AND volumes (`9router_federation_net`,
`9router_central-data`, ...) — `docker compose config` resolves clean, no warning.
Also `docker-compose.yml` pins volume `name: 9router-data` explicitly (global
across projects); compose warns but proceeds to mount it. The header block of
docker-compose.federation.yml documents the coexistence command WITHOUT `-p` —
do not copy it verbatim (row DF-9ROUTER-48).

Port collisions are loud (EADDRINUSE at up) — host ports 20128/20129/20130/8787
are commonly busy; overrides: `PORT`, `HEADROOM_PORT`,
`FEDERATION_CENTRAL_PORT`/`FEDERATION_EDGE_A_PORT`/`FEDERATION_EDGE_B_PORT`
(host side only; container-side stays 20128; intra-network URL stays
`http://central:20128`).

## Secrets: one .env, shared by all instances

`docker-compose.federation.yml` reads the repo `.env` via `env_file`. A fresh
clone has none — the stack boots with image defaults and you cannot log in
remotely. Do the user step first:

```bash
cp .env.example .env   # set INITIAL_PASSWORD, JWT_SECRET, API_KEY_SECRET (+ FEDERATION_TOKEN)
```

FEDERATION_TOKEN, JWT_SECRET, API_KEY_SECRET, INITIAL_PASSWORD MUST be identical
on every instance of the stack (they come from the same .env here — that is the
mechanism, per docs/FEDERATION.md §3 env matrix). Changing `.env` after up
requires `docker compose up -d` (recreate), not restart.

## The workflow that proves a federation deploy (10 min)

```bash
# health on all three ports (default 20128/20129/20130)
curl -s localhost:20128/api/health

# seed central (session cookie; password = INITIAL_PASSWORD from .env)
curl -c /tmp/cj -X POST localhost:20128/api/auth/login -H 'Content-Type: application/json' \
  -d '{"password":"..."}'
curl -b /tmp/cj -X POST localhost:20128/api/keys -H 'Content-Type: application/json' -d '{"name":"k1"}'
curl -b /tmp/cj -X POST localhost:20128/api/provider-nodes -H 'Content-Type: application/json' \
  -d '{"name":"up","prefix":"dlm","apiType":"chat","type":"openai-compatible","baseUrl":"http://LM:1234/v1"}'
# then POST /api/providers with {provider:<node.id>, apiKey:"x", name:"cred"} — node alone is NOT enough

# A: edge linked?
curl -s localhost:20129/api/federation/local-status | jq -c '{last_state, revisionLag}'
# B: completion THROUGH the edge (model id = <prefix>/<model>)
curl -s -X POST localhost:20129/v1/chat/completions -H "Authorization: Bearer sk-..." \
  -H 'Content-Type: application/json' -d '{"model":"dlm/<model>","stream":false,"max_tokens":600,
  "messages":[{"role":"user","content":"ping"}]}'
# D lifecycle: docker stop <prefix>-central; wait 20s; local-status -> degraded;
#   /v1 through edge STILL 200; POST /api/keys -> 202 + X-Federation-Queued-Write-Id;
#   docker start; linked again ~20s; the queued key exists on BOTH sides.
```

Integrity probe (catches FED-020-class replica corruption) — compare row metadata
INSIDE the containers:

```bash
docker exec <prefix>-central node -e "const db=require('better-sqlite3')('/app/data/db/data.sqlite',{readonly:true});console.log(db.prepare('SELECT id,federation_version,updated_at FROM apiKeys').all())"
# same on <prefix>-edge-a; versions and updated_at must MATCH
```

## Pitfalls learned on this surface

- **max_tokens must leave room for reasoning models.** qwen3.8-27b spent all 40
  completion_tokens on `reasoning_content` and returned `content:""` with HTTP 200.
  Use max_tokens >= 600 for qwen3.8-style models in probes.
- **`/api/federation/status` is a LOCAL status payload** (FED-005), not an edge
  registry — on central it returns the central role with no `edges` array. That is
  by design; use each edge's `/api/federation/local-status` for per-edge state.
- **Upgrade in place is safe and measured:** `-f docker-compose.yml -f
  docker-compose.local-build.yml up -d --build --no-deps 9router` rebuilds into tag
  `9router:local` (never overwrites the published tag), recreates the container on
  the same named volume — data and API keys survive (verified).
- **The standalone image is `decolua/9router` (upstream, no federation code)** —
  do not point FEDERATION_* env at it; federation needs `docker-compose.federation.yml`
  → `Dockerfile.federation` (ships src/ + the `@/` alias symlink).
- **dind/fresh-daemon installs have no curl** in the 9router image — `apk add curl`
  as root inside the container for probes, or use busybox wget (no cookie flags).
- Reasoning models emit `reasoning_content` deltas on SSE before content deltas —
  a naive SSE consumer that only reads `delta.content` shows "empty" streams.
