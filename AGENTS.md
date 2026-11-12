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

### Intentional tracked layout

- **Application:** `src/`, `public/`, `images/`, and `i18n/` hold the Next.js gateway,
  dashboard, static assets, and translations.
- **Provider engine:** `open-sse/` contains provider-agnostic request translation and
  execution; provider integrations remain tracked source, including generated registries
  that must not be hand-edited.
- **CLI and tests:** `cli/` is the separately packaged launcher; `tests/` is its own ESM
  test package with federation E2E coverage.
- **Documentation and skills:** `README.md`, `DOCKER.md`, `docs/`, `gitbook/`, and
  `skills/` are tracked documentation surfaces. Dated verification evidence belongs in
  `docs/dogfood/`.
- **Deployment and runtime entrypoints:** `Dockerfile*`, `docker-compose*.yml`,
  `custom-server.js`, `start.sh`, and `captain-definition` are intentional operational
  surfaces; root package/config files support the application, CI, linting, and builds.
- **Generated or local-only:** ignored `node_modules/`, `.next/`, `.next-cli-build/`,
  `dagger.db*`, `.vfs/`, coverage/build outputs, and board DB/Parquet caches are not
  tracked source. `.coding-hermes/` and `.gitreins/` hold fleet/guard state and fixtures;
  do not clean or regenerate them during repository-layout work.

## Commands

```bash
cp .env.example .env
npm install
PORT=20128 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run dev    # dev (port 20128 default via package.json scripts; FEDERATION_MODE=edge NOT supported — FATAL exit, use production path)
npm run build && PORT=20128 HOSTNAME=0.0.0.0 npm run start            # production
npm run cli:pack                                                      # CLI launcher package (cli/)
# Tests (independent ESM package in tests/ — its OWN dependency tree; pins vitest ^4.0.0):
npm install                                                           # root deps (tests/ imports from src/, which needs open/undici/…)
cd tests && npm install && cd ..                                      # REQUIRED once: installs the pinned vitest into tests/node_modules
npm test                                                              # from repo root — deterministic entry: runs the tests-local vitest, never a bare `npx vitest`; when tests deps are missing it fails fast naming `cd tests && npm install`. It cds into tests/ because a root cwd breaks @/ alias resolution
npm test -- unit/fresh-install-model-catalog-339.test.js              # single file — args are forwarded to vitest (path relative to tests/)
node tests/__baseline__/verify-no-regression.mjs <vitest-json-results>  # regression gate (known-fails baseline)
npm run lint                                                          # repo-wide eslint over the FULL tree — RED BY DESIGN, see "Lint debt" below
npm run lint:gate                                                     # lint debt gate — full-tree eslint vs the committed baseline; fails on NEW/INCREASED problems, on STALE entries, and ALWAYS on parse errors
npm run lint:baseline                                                 # regenerate scripts/lint-baseline.json (commit it together with the paydown); REFUSES to write when any file has a parse error
```

**The suite is NOT all-green by design**: ~2749 pass / ~81 fail / ~61 skip baseline (2891 total,
verified 2026-09-19) with a
catalogued `tests/__baseline__/known-fails.txt`. Judge regressions with
`verify-no-regression.mjs`, never a raw run. Live-network tests (`real/*.real.test.js`,
`unit/mimo-free.live.test.js`) are opt-in via `RUN_REAL=1` — a default run skips them and they
are not part of the baseline.

**Lint is RED BY DESIGN** — the repo carries **135 errors / 204 warnings (339 problems) across
218 files** with `npm run lint` (measured 2026-09-19 at HEAD `adb0bf3f`, 1306 files linted).
This is pre-existing debt, not a failure of the change under judgement: it is **frozen in
`scripts/lint-baseline.json`** (keyed by exact identity `<file>|<ruleId>|<severity>`) and gated by
`npm run lint:gate`, which is what the change must not break. The gate:

- runs eslint over the **FULL tree** (`eslint .` from the repo root, root-local
  `node_modules/eslint`) — never a file-scoped or partial run;
- **FAILS on NEW/INCREASED problems** (printed `NEW/INCREASED <file> <rule> <before> -> <after>`);
- **FAILS on STALE/orphan baseline entries** — a baselined problem that no longer exists means the
  baseline no longer describes the tree and would hide the very regressions the gate exists to
  catch. Paying debt down therefore requires `npm run lint:baseline` + committing the refreshed
  baseline in the same commit as the paydown;
- **ALWAYS fails on a parse error** (`fatal: true`), and `npm run lint:baseline` **refuses to
  write** a baseline while one exists — a file that does not parse hides every other result for it,
  so it must be repaired, never recorded.

Gitignored build output is excluded so generated code is never linted: `eslint.config.mjs`'s
`globalIgnores` covers `**/.next-cli-build/**` (the `**/` prefix is required — flat-config ignore
patterns containing a slash are anchored to the config's base path, and without it the nested
`cli/app/.next-cli-build/**` + `.next-cli-build/standalone/**` copies put 2166 generated files,
63% of the tree, back into the lint scope).

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
- **Usage tracking**: SQLite-backed in the main DB (`usageHistory`/`usageDaily`
  tables via `src/lib/db/repos/usageRepo.js`; `src/lib/usageDb.js` is a compat
  shim re-exporting it). Follows `DATA_DIR` like all other state — no separate
  `usage.json`/`log.txt` files remain.
- **Cloud sync status:** the former external cloud-sync scheduler and routes are
  not shipped. `CLOUD_URL` remains only for dashboard URL matching; federation
  is the supported multi-instance design and is documented in
  `docs/federation-spec.md`.
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
- **Lint**: `guards.lint` stays **false** in `.gitreins/config.yaml` — `npm run lint` is
  red by design (135 errors / 204 warnings of pre-existing debt, frozen in
  `scripts/lint-baseline.json`). Judge lint changes with the full-tree
  `npm run lint:gate` (fails on NEW/INCREASED problems, on STALE baseline entries, and always on
  parse errors); pay debt down with `npm run lint:baseline`. Full status: see "Commands".
- Commit style: Conventional Commits (`feat(federation): …`). Update
  `CHANGELOG.md` for user-visible changes.

## Board

- `.coding-hermes/board/` JSONL canonical: `tasks.jsonl` + `events.jsonl`
  (git-tracked, DuckDB-native via `read_json_auto`). `board.db` / `*.parquet`
  are untracked rebuildable caches. `board.jsonl` = header (project/namespace/
  tick counters/cooldown). `fixtures.jsonl` = perpetual tasks
  (NEVER-DONE, E2E-001, GITREINS-JUDGE). Schema: `.coding-hermes/board/schema.sql`.
- Task IDs: `FED-00N` (federation feature phases). Specs: `docs/federation-spec.md`
  (authoritative; per-phase breakdown in §5) + `docs/specs/` (per-phase index).

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

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
