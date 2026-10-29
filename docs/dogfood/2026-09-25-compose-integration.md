# Dogfood Run 15 — the docker-compose deployment surface (2026-09-25)

**Verdict: 🟡 PROMISING-BUT-ROUGH.** The compose deployment promise holds end-to-end —
federation lifecycle (kill→DEGRADED→queue→drain→reconcile) verified with containers as
the unit, standalone quickstart + local-build fallback + upgrade-in-place all PASS — but
a copy-paste coexistence command silently targets the running stack's volumes, and
DOCKER.md never tells a container user how to log in.

**Angle:** 14 prior runs swept the CLI, gateway endpoints, federation acceptance (bare
processes), RTK product layer, multimodal, and the UI bootstrap. None ever drove the
docker-compose path; every bunker battery's compose cells died on the compose plugin.
This run took the deployment surface: `docker-compose.yml` (published images),
`docker-compose.local-build.yml` (override), `docker-compose.federation.yml`
(central + 2 edges), `Dockerfile.federation`.

## What was driven (all real, no test suite)

### Federation stack — `docker-compose.federation.yml`
- `docker compose config` validates with the documented overrides (0s).
- Build + boot of all 3 instances (central, edge-a, edge-b) from `Dockerfile.federation`:
  **247s** on the N100 control host, `FEDERATION_STACK_PREFIX=ninedf`, ports 21133-35,
  **explicit `-p ninedf`** (see finding DF-48 — the documented command omits `-p`).
- All 3 healthy on first boot; federation migrations #2-#5 applied; `.env` read via
  `env_file` (shared FEDERATION_TOKEN / JWT_SECRET / API_KEY_SECRET / INITIAL_PASSWORD).
- Seeded central over its documented dashboard API: login → API key → provider node
  (openai-compatible → LM Studio over tailnet) → credential connection.
- **Check A** replication: edge LINKED, `revisionLag: 0` within seconds.
- **Check A+** row integrity (the FED-020 regression probe) inside containers:
  `federation_version` and `updated_at` byte-identical central vs edge
  (`better-sqlite3` readonly read of `/app/data/db/data.sqlite` in both).
- **Check B** authenticated completion THROUGH the edge: 200, exact content
  ("COMPOSE-EDGE-OK"), 1.2s warm; streaming works through the edge; edge-b also verified.
- **Check C** federation API answers 401 with no token.
- **Check D — the lifecycle, containers as the unit:**
  `docker stop ninedf-central` → edge flips `degraded` (~15s threshold) →
  `/v1` still served from the replica (1.8s, correct content) → mutating write through
  the edge returns **202 + `X-Federation-Queued-Write-Id`** → `docker start` →
  edge `linked` after ~20s → queued key reconciled **on both sides**, revisionLag 0 →
  completion through the edge again OK.

### Standalone stack — `docker-compose.yml` + published images
- `docker compose -p ninedfsa up -d` (PORT=21136, HEADROOM_PORT=21137): **19s** warm.
- Pulls `decolua/9router:latest` + `ghcr.io/chopratejas/headroom:latest` — both pullable,
  headroom reports healthy, and the compose wiring promise holds inside the container:
  `http://headroom:8787/health` reachable from the 9router container.
- Full workflow on the container: login → key → node → credential → completion
  ("STANDALONE-DOCKER-OK", 1.9s).
- `docker restart 9router` → healthy after 3s → key survived → completion works.

### Local-build fallback + upgrade-in-place — `docker-compose.local-build.yml`
- `... -f docker-compose.yml -f docker-compose.local-build.yml up -d --build --no-deps
  9router` on the RUNNING standalone stack: **249s** build, container recreated on
  `9router:local`, same data volume, same API key, completion immediately works.
- Fresh-daemon install (docker-in-docker, empty image cache, no compose state, tree
  streamed WITHOUT `.env`/node_modules): documented local-build path boots a working
  instance in **271s cold**; the fresh-user env step (`INITIAL_PASSWORD` in `.env`,
  recreate) then login → key → node → credential → completion ("FRESH-DAEMON-OK").

## Findings (board rows DF-9ROUTER-48..51)

1. **DF-48 (P1) — the documented coexistence command omits `-p` and the base file's
   explicit volume name crosses projects.** Running the compose header's verbatim
   coexistence example (`FEDERATION_STACK_PREFIX=9r-fed FEDERATION_CENTRAL_PORT=21128
   ... up`) resolves project name `9router`, network `9router_federation_net`, and
   volumes `9router_central-data`/`9router_edge-a-data`/`9router_edge-b-data` — the
   LIVE stack's. `config` resolves clean with zero warnings; only container names
   (prefixed) and host ports differ, so a user discovers the shared state the hard way.
   Separately, `docker-compose.yml` sets `name: 9router-data` explicitly, making it
   global: compose actually WARNED (`volume "9router-data" already exists but was
   created for project "9router" (expected "ninedfsa")`) and mounted it anyway. This
   run verified the volume empty BEFORE mounting (no contamination) and never touched
   the production-named volumes. The 2026-09-13 run flagged "cannot coexist" (ports);
   commits 7f25e31a + 981c7f6e fixed auth and documented the override knobs — the
   remaining trap is project identity, and it is one `-p` away from fixed.
2. **DF-49 (P1) — DOCKER.md never mentions login.** The docker quickstart section has
   no word about `.env`, `INITIAL_PASSWORD`, or how to log into the dashboard it says
   to open. With no `.env` the container runs on built-in defaults; login then requires
   either the default password from the LOCAL host or the CLI reset flow, none of which
   DOCKER.md says. A docker user's first action after `open http://localhost:20128`
   dead-ends. (Verified on the fresh-daemon leg: the default-password login path is
   correctly hardened — the missing piece is the docs, not the code.)
3. **DF-50 (P2) — first-completion cold-start outlier on a model's first use: 17.9s**
   once, upstream-attributed (first-ever call loaded the model; steady state 578-832ms;
   edge path unaffected 541-650ms). Recorded with numbers so the next "9router is
   sometimes slow" report can be checked against it.
4. **DF-51 (P2) — no bunker install leg this run** (all four las bunker hosts
   unreachable or bunkerd stuck `activating`); compensated with a fresh-daemon
   install on the control host (271s cold, full workflow). Filing the SKIPPED row
   keeps the infra signal alive.

## Performance (real-use numbers; no PERF row — nothing a user would call slow)

| operation | number |
|---|---|
| federation stack build + boot (3 images, N100) | 247s |
| standalone `up` (published images, warm cache) | 19s |
| local-build swap (build + recreate, data kept) | 249s |
| fresh-daemon cold install → working completion | 271s |
| `/v1/models` through router | 180ms (edge) / 209ms (central) vs 363ms direct |
| completion, steady state | edge 610ms, central 670ms, direct 326ms |
| cold first completion after container restart | 728ms |
| container restart → serving | 3s (standalone) / ~20s (edge re-link) |

The router's model cache made `/v1/models` FASTER than calling LM Studio directly.
Router overhead on completions is ~280ms (610 vs 326 direct) — invisible next to
model latency. **Nothing here is slow enough that a user would notice; no PERF row.**

## If I had one hour of the maintainer's time

1. **DF-48** — add `-p` to the compose header's coexistence command (and/or stop
   pinning `name: 9router-data`). Two-state corruption from one missing token is the
   worst failure mode left on this surface.
2. **DF-49** — three lines in DOCKER.md: `cp .env.example .env` (set
   INITIAL_PASSWORD) before `up`, then log in with that password.
