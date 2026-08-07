# AGENTS.md — 9router Federation Fork

## What this is

A fork of **9router** (github.com/decolua/9router, MIT, ~25k stars) — a LOCAL AI
routing gateway + Next.js dashboard. The fork's mission: build a **federation
feature** as a clean, mergeable PR back upstream.

**Federation goal (Bane, 2026-08-07):**
1. Deploy the SAME 9router system on multiple instances across datacenters/hosts.
2. Edge instances **proxy up to the CENTRAL instance by default** (all `/v1` traffic + dashboard API).
3. Edges continuously **track/replicate the central instance's database** so if central
   goes DOWN, edges keep serving independently — dependent services never go down.
4. Frontend/dashboard can run **once per datacenter or once per host** (local UI per instance,
   backed by local replica or central).
5. Writes during a central outage are absorbed/queued locally, reconciled later (eventual consistency).
6. Standalone mode remains the default — zero disruption to upstream behavior.

## Repo layout & remotes

- Fork: `https://github.com/totalwindupflightsystems/9router` (origin)
- Upstream: `https://github.com/decolua/9router` (upstream remote)
- Default branch: `master` (fork mirrors upstream). Work branch: **`federation`**.
- The PR is opened from `totalwindupflightsystems/9router:federation` → `decolua/9router:master`.

## Commands

```bash
cp .env.example .env
npm install
PORT=20128 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run dev    # dev (port 20127 default via next dev)
npm run build && PORT=20128 HOSTNAME=0.0.0.0 npm run start            # production
npm run cli:pack                                                      # CLI launcher package (cli/)
# Tests (independent ESM package in tests/):
npm install && cd tests && npm install && cd ..
npx vitest run                                                        # from tests/ (auto-discovers vitest.config.js)
node tests/__baseline__/verify-no-regression.mjs <vitest-json-results>  # regression gate (known-fails baseline)
npx eslint .                                                          # lint
```

**The suite is NOT all-green by design**: ~1673 pass / ~88 fail / ~59 skip baseline with a
catalogued `tests/__baseline__/known-fails.txt`. Judge regressions with
`verify-no-regression.mjs`, never a raw run. `real/*.real.test.js` need live
credentials — skip them.

## Architecture (the parts that matter for federation)

- **Stack**: Next.js 16 app (plain JS ESM, no TypeScript), `@/*` → `src/*`.
- **Request flow**: client → `/v1/*` (next rewrites → `src/app/api/v1/*`) →
  `src/sse/handlers/chat.js` (combo expansion, account selection) →
  `open-sse/handlers/chatCore.js` (format translation, executor dispatch,
  retry/refresh, SSE) → `open-sse/executors/*` per provider.
- **Persistence**: SQLite adapter chain `bun:sqlite` → `better-sqlite3` →
  `node:sqlite` → `sql.js` (pure-JS fallback). DB at `DATA_DIR` or `~/.9router/`.
  Declarative schema `src/lib/db/schema.js` (auto-sync) + versioned migrations
  `src/lib/db/migrations/`. Tables: `settings`, `providerConnections`,
  `providerNodes`, `proxyPools`, `apiKeys`, `modelAliases`, `combos`,
  `pricing`, usage tables. WAL mode.
- **Usage tracking** (separate): `usage.json` + `log.txt` under `~/.9router`
  (does NOT follow `DATA_DIR`).
- **Existing cloud sync** (optional, external service, code NOT in repo):
  `src/lib/initCloudSync.js`, `src/shared/services/cloudSyncScheduler.js`,
  `/api/sync/cloud` (enable/sync/disable), `POST /sync/{machineId}`,
  `GET /{machineId}/v1/verify`, API-key auth + `node-machine-id`.
  **The federation design decides whether to extend this or build a dedicated
  federation sync — see `docs/federation-spec.md` (authoritative).**
- **Auth**: JWT cookie (`JWT_SECRET`), `INITIAL_PASSWORD`, `API_KEY_SECRET`,
  `MACHINE_ID_SALT`.
- **Deployment**: Dockerfile + docker-compose (next standalone),
  `custom-server.js` strips attacker `X-Forwarded-For` (trusts loopback proxy only).
  Default port 20128, dashboard `/dashboard`.

## Quality gates (GitReins)

- `.gitreins/config.yaml` — secrets guard (BLOCKS), tests guard = regression
  baseline via `scripts/gitreins-guard-tests.sh` (skips when test deps absent),
  evaluator caps 100 iterations / 1M in / 384k out, deepseek-v4-flash judge.
- Tier 2 judge runs against task criteria — create GitReins tasks per board task
  (`gitreins task create`), complete with `gitreins task complete` → judge verdict.
- Commit style: Conventional Commits (`feat(federation): …`). Update
  `CHANGELOG.md` for user-visible changes.

## Board

- `.coding-hermes/board/` JSONL canonical: `tasks.jsonl` + `events.jsonl`
  (git-tracked, DuckDB-native via `read_json_auto`). `board.db` / `*.parquet`
  are untracked rebuildable caches. `board.jsonl` = header (project/namespace/
  tick counters/cooldown). `fixtures.jsonl` = perpetual tasks
  (NEVER-DONE, E2E-001, GITREINS-JUDGE). Schema: `.coding-hermes/board/schema.sql`.
- Task IDs: `FED-00N` (federation feature phases). Specs: `docs/federation-spec.md`
  + `docs/specs/` per phase.

## DuckBrain

- Namespace: **`9router`** (`~/duckbrain/namespaces/9router/`), HTTP API at
  `localhost:3000` (`POST /api/memories?namespace=9router`).
- Key areas: `/project/9router/identity`, `/project/9router/architecture`,
  `/project/9router/federation/design`, `/project/9router/federation/spec-*`,
  `/project/9router/analysis/<model>` (gpt-5.6-sol / grok-4.5 / glm-5.2 findings).

## Rules

- DO NOT touch provider registry auto-generated files (`providers/registry/index.js`) by hand.
- DO NOT commit secrets; `INITIAL_PASSWORD`, `JWT_SECRET` etc. stay in `.env`.
- Federation changes MUST keep standalone mode working (default, no new env required).
- Every federation feature needs tests (vitest, in `tests/`) + docs update.
- Never force-push `master`; work on `federation` branch.
