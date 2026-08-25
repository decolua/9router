# Project: 9router-app (9Router)

Local-first fork of `decolua/9router` — an OpenAI-compatible AI routing gateway + Next.js dashboard. Routes traffic across 40+ upstream providers with format translation, model-combo fallback, multi-account fallback, OAuth/API-key credential management, token refresh, and quota/usage tracking.

Two published artifacts in this one repo:
- **Dashboard + gateway** (root `package.json`, `9router-app`) — the Next.js server that does the actual routing.
- **CLI launcher** (`cli/`, published to npm as `9router`) — separate package, own version/build, installs/starts the server and manages the tray.

See `docs/ARCHITECTURE.md` for the full system design and `open-sse/AGENTS.md` for the routing/translation engine's own conventions — read that before editing anything under `open-sse/`.

## Stack & Tech

- Plain JavaScript (ESM), **no TypeScript**. `@/*` path alias → `src/*` (`jsconfig.json`).
- Next.js (App Router) for the dashboard + `/v1/*` API routes.
- SQLite persistence under `src/lib/db/` with adapter fallback chain: `bun:sqlite` → `better-sqlite3` (optional native dep) → `node:sqlite` (Node ≥22.5) → `sql.js` (pure-JS, always works).
- Test runner: Vitest, in `tests/` — an **independent ESM package**, not wired into root `npm test`.
- Lint: ESLint (`eslint.config.mjs`, extends `eslint-config-next`).

## Commands

Dashboard/gateway (repo root):
```bash
cp .env.example .env
npm install
PORT=20128 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run dev
npm run build && PORT=20128 HOSTNAME=0.0.0.0 npm run start
```
Bun variants: `npm run dev:bun` / `build:bun` / `start:bun`. Default port **20128** (dashboard at `/dashboard`, API at `/v1`).

CLI package (`cli/`):
```bash
npm run cli:pack       # build + npm pack from root
cd cli && npm run dev  # nodemon watch
```

Tests (from `tests/`, needs root deps installed first):
```bash
npm install              # root deps first — tests import from src/ which needs `open`, `undici`, etc.
cd tests && npm install  # then tests' own deps → tests/node_modules
npx vitest run                              # all tests
npx vitest run unit/capabilities.test.js    # single file (path relative to tests/)
```
The committed `tests/package.json` `test` script hardcodes Unix paths (`NODE_PATH=/tmp/node_modules …`) — ignore it, use the `npx vitest` form above.

**The suite is NOT expected to be all-green on a plain checkout.** ~938 pass, ~64 fail. Judge regressions with `tests/__baseline__/verify-no-regression.mjs`, not a raw run. Known-red is catalogued in `tests/__baseline__/known-fails.txt` plus a few environment-dependent files (`unit/embeddings.cloud.test.js` needs the out-of-repo `cloud/` worker, `unit/xai-oauth-service.test.js` needs live network, `real/*.real.test.js` need live provider credentials).

## Architecture

- `src/app/api/v1/*` (Next rewrite `/v1/*` → `/api/v1/*`) → `src/sse/handlers/chat.js` (parse, combo expansion, account-selection loop) → `open-sse/handlers/chatCore.js` (translate, dispatch, retry/refresh, stream) → `open-sse/executors/*` (per-provider upstream call) → `open-sse/translator/*` (client format ↔ provider format) → SSE back to client.
- `src/sse/` is app-side entry glue; `open-sse/` is the provider-agnostic engine (also usable standalone). Cross that boundary consciously.
- Translator pivots through **OpenAI as the intermediate format**; a translator registered on an exact `source:target` pair runs as a direct route, skipping the lossy double-hop. Translators self-register via `register(from, to, reqFn, resFn)` — new files MUST be imported in `open-sse/translator/index.js`.
- Provider registry: one file per provider in `open-sse/providers/registry/*`; `index.js` is auto-generated, don't hand-edit — regenerate with `scripts/migrate-registry.mjs`.
- `src/lib/localDb.js` is a backward-compat shim re-exporting `src/lib/db/index.js`; new code imports from `@/lib/db/index.js`. Per-entity logic in `src/lib/db/repos/*`. Schema/migrations in `src/lib/db/migrations/`.
- `open-sse/rtk/` (token saver) mutates request bodies in-place and is **fail-open** — any error returns null, body untouched, never throws.

## Code Style

- Plain JS/ESM, camelCase, config-driven — never hardcode model/role/block strings; use `open-sse/config/` + `open-sse/translator/schema/` constants.
- Match existing patterns in the file/module being touched. `custom-server.js` derives client IP from the TCP socket and strips attacker-controlled `X-Forwarded-For` — preserve this when touching request/IP/rate-limit code.
- Conventional Commits style (`fix(translator): …`, `feat(...)`). Root and `cli/` are versioned independently; log changes in `CHANGELOG.md`.

## Important Rules

- NEVER commit `.env` files or secrets.
- Never suppress type/lint errors to force a green build.
- Security-sensitive env: `JWT_SECRET`, `INITIAL_PASSWORD` (default `123456` — must override in any real deployment), `API_KEY_SECRET`, `MACHINE_ID_SALT`. Full contract in `.env.example` / `docs/ARCHITECTURE.md`.
- Binary/protobuf upstreams (kiro EventStream, cursor protobuf, commandcode NDJSON) don't round-trip through the OpenAI translator bridge — handle them inside their own executor.

## Gotchas

- **Do NOT run `npm run build` (or trust a Windows test run as the final gate) on this Windows workstation.** Next.js production builds reliably fail/OOM here even with an increased Node heap — this is a known, unfixable environment limitation, not a code bug. It has manifested as both V8 heap OOM and an unrelated `EPERM: operation not permitted, readlink` on an unrelated UV Python cache wheel during file tracing.
  - **The homelab is the only authoritative build gate.** Full procedure: `docs/ops/NINEROUTER_HOMELAB_BUILD_TEST.md` (Docker build at `/home/itsnulla/9router-build` via `ssh homelab`) and `docs/ops/NINEROUTER_DEV_DEPLOYMENT.md` (safe deploy + verification to the `ninerouter-dev` dev container).
  - On Windows, only run **targeted** Vitest files/dirs (`cd tests && npx vitest run <path>`) for fast local iteration — never treat a Windows vitest run as proof the full baseline is green, and never claim "build passes" from Windows.
- `tests/__baseline__/verify-no-regression.mjs` splits report paths on `"/app/"`, which is Docker-container-path-shaped and breaks on native Windows paths — run baseline comparisons on Linux/homelab, not Windows.
- `better-sqlite3` is an optional native dependency by design (see `src/lib/db/driver.js` fallback chain) so `npm install` never hard-fails without build tools — don't "fix" a missing native binding by making it a hard dependency.
- Homelab dev container (`ninerouter-dev`) mounts a persistent volume `9router-dev-data` at `/app/data` — never run `docker compose down -v`, `docker volume rm 9router-dev-data`, or otherwise touch that mount when deploying/rolling back.
