# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

9Router (`9router-app`) — a local AI routing gateway + Next.js dashboard. It exposes one OpenAI-compatible endpoint (`/v1/*`) and routes traffic across 40+ upstream providers with format translation, model-combo fallback, multi-account fallback, OAuth/API-key credential management, token refresh, quota/usage tracking, and optional cloud sync.

Two published artifacts live in this one repo:
- The **dashboard + gateway** (root `package.json`, `9router-app`) — the Next.js server that does the actual routing.
- The **CLI launcher** (`cli/`, published to npm as `9router`) — a separate package that installs/starts the server and manages the tray. It has its own `package.json`, version, and build.

The code lives in `src/` (Next.js app + dashboard/compat APIs), `open-sse/` (the provider-agnostic routing/translation engine), `cli/` (the launcher package), and `tests/`.

## Commands

Dashboard/gateway (run from repo root):
```bash
cp .env.example .env
npm install
PORT=20128 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run dev   # dev (webpack, port 20127 by default via next dev)
npm run build && PORT=20128 HOSTNAME=0.0.0.0 npm run start           # production
```
- Bun variants: `npm run dev:bun` / `build:bun` / `start:bun`.
- Default runtime port is **20128** (dashboard at `/dashboard`, API at `/v1`).
- Lint: `npx eslint .` (config `eslint.config.mjs`, extends `eslint-config-next`).

CLI package (`cli/`):
```bash
npm run cli:pack       # build + npm pack from root
cd cli && npm run dev  # nodemon watch
```

Tests (vitest, in `tests/`, an **independent** ESM package — not wired into root `npm test`):
```bash
npm install                             # ROOT deps first — tests import from src/ which needs `open`, `undici`, etc.
cd tests && npm install                 # then tests' own deps (vitest) → tests/node_modules (allowed by tests/.gitignore)
npx vitest run                          # all tests; auto-discovers tests/vitest.config.js
npx vitest run unit/capabilities.test.js   # single file (path relative to tests/)
```
> The committed `tests/package.json` `test` script hardcodes Unix paths (`NODE_PATH=/tmp/node_modules …`) — a shared-install workaround from upstream. On Windows (or anywhere), ignore it and use the `npx vitest` form above; `vitest.config.js` resolves the `open-sse`/`@/` aliases from the repo root regardless of where vitest lives.
>
> **The suite is NOT expected to be all-green on a plain checkout.** 1846 pass, 84 fail (re-measured 2026-08-12). Judge regressions with `tests/__baseline__/verify-no-regression.mjs`, not a raw run:
> ```bash
> cd tests && npx vitest run --reporter=json --outputFile=/tmp/results.json
> cd .. && node tests/__baseline__/verify-no-regression.mjs /tmp/results.json
> ```
> - All are catalogued in `tests/__baseline__/known-fails.txt`, so the gate is meaningful again. It had drifted badly — 24 entries against 98 actual failures — and the verifier itself only worked inside the container, because it recovered the repo-relative path by splitting on `/app/`. It now anchors on the `tests/` segment, so it runs anywhere. Regenerate the list the same way you verify, writing the failures to that file, and only when you have confirmed the new reds are not yours. Regenerate from the **union of two runs** — one on your branch and one on a stashed clean tree. `unit/cli-xai-video.test.js` and `unit/xai-oauth-service.test.js` alternate between passing and failing across runs, so a baseline built from a single run makes the next run look like a regression.
> - The largest block, 35 in `unit/cursor-agent-proto.test.js`, imports `buildAgentRunFrame`, `encodeAgentValue` and six other symbols that **exist nowhere in the source** — it is a test for a Cursor AgentService codec that was never written. Delete it or write the codec; do not "fix" it.
> - `unit/embeddings.cloud.test.js` imports `cloud/src/handlers/embeddings.js` — the `cloud/` worker dir is **not in this repo**, so it always fails here.
> - `unit/xai-oauth-service.test.js` times out (5s) when the xAI endpoint-discovery fetch isn't reachable/mocked.
> - `real/*.real.test.js` make live provider calls — need credentials, skip otherwise.
- `*.real.test.js` under `tests/translator/real/` make live provider calls — skip unless credentials are set.
- Regression baselines: `tests/__baseline__/verify-*.mjs` compare against committed snapshots (providers, aliases, OAuth URLs). Run these after touching provider registry / alias logic.

## Architecture

Two authoritative docs already exist — read them before working in these areas rather than re-deriving:
- `docs/ARCHITECTURE.md` — full system: request lifecycle, combo/account fallback, OAuth + token refresh, cloud sync, data model.
- `open-sse/AGENTS.md` — the routing/translation engine's own conventions and "how to add a provider/executor/translator". **Read this before editing anything under `open-sse/`.**

### Request flow (the thing to understand first)
`src/app/api/v1/*` route (Next rewrite maps `/v1/*` → `/api/v1/*` in `next.config.mjs`)
→ `src/sse/handlers/chat.js` (parse, combo expansion, account-selection loop)
→ `open-sse/handlers/chatCore.js` (detect source format, translate request, dispatch to executor, retry/refresh, stream setup)
→ `open-sse/executors/*` (per-provider upstream call; `default.js` handles any OpenAI-compatible provider)
→ `open-sse/translator/*` (client format ↔ provider format)
→ SSE back to client.

`src/sse/` is the app-side entry glue; `open-sse/` is the provider-agnostic engine (also usable standalone). Cross that boundary consciously.

### Translator engine (`open-sse/translator/`)
- Pivots through **OpenAI as the intermediate format**. A translator registered on an exact `source:target` pair (e.g. `claude:kiro`) runs as a **direct route**, skipping the lossy double-hop. Prefer a direct route for fragile pairs (thinking blocks, tool ids, non-base64 images, `is_error`).
- Translators **self-register** via `register(from, to, reqFn, resFn)` as an import side effect — a new translator file MUST be imported in `open-sse/translator/index.js` or it never runs.
- Never hardcode role/block/model strings — use `open-sse/translator/schema/` and `open-sse/config/` constants. Config-driven and DRY is enforced by convention here.

### Provider registry (`open-sse/providers/registry/*`)
- One file per provider. `providers/registry/index.js` is an **auto-generated** static import list — regenerate it with `scripts/migrate-registry.mjs` / `injectDisplayToRegistry.mjs`, don't hand-edit.
- Add a provider: copy `providers/REGISTRY_TEMPLATE.js`, add models to `config/providerModels.js`. Only add an executor for non-OpenAI-compatible upstreams.

### Persistence — IMPORTANT (ARCHITECTURE.md is stale here)
State is **no longer `db.json`**. It's a SQLite layer under `src/lib/db/` with an adapter fallback chain (`driver.js`): `bun:sqlite` → `better-sqlite3` (optional native dep) → `node:sqlite` (Node ≥22.5) → `sql.js` (pure-JS fallback, always works). `better-sqlite3` is deliberately in `optionalDependencies` so install never fails without build tools.
- `src/lib/localDb.js` is a **backward-compat shim** re-exporting `src/lib/db/index.js`. New code should import from `@/lib/db/index.js`; per-entity logic lives in `src/lib/db/repos/*`. Schema/migrations in `src/lib/db/migrations/`.
- DB file location resolves via `src/lib/db/paths.js` (`DATA_DIR`, else `~/.9router/`).
- Usage/logs (`src/lib/usageDb.js`, `usage.json` + `log.txt`) still live under `~/.9router` and do **not** follow `DATA_DIR`.

### RTK token saver (`open-sse/rtk/`)
Pre-translate hooks that compress `tool_result` content in-place to cut tokens. **Fail-open**: any error returns null and leaves the body untouched — never throw out of them. Skips `is_error`/`status:"error"` results to preserve traces.

Not everything here is compression. `systemInject.js` is the shared, format-aware system-prompt appender (Claude `system[]`, Gemini `systemInstruction.parts`, OpenAI `messages[]`/`instructions`), and three hooks build on it: `caveman`/`ponytail` (style, opt-in), `disciplineNudge` (corrects a past malformed-output strike; **stateful**, armed by `recordStrike` and consumed once), and `orchestrationNudge` (states the live delegation count when a session is over cap; **stateless** — it recomputes from the request body each turn because the condition is still true, see `docs/adr/0003`). The last two are unconditional: they are policy corrections, not token savers, so they do not check `tokenSaverEnabled`. Note the ordering — `translateRequest` runs first (`handlers/chatCore.js`), then RTK/Headroom, then these injectors; anything counting client-shaped tool blocks must read the **source** body and inject into the **translated** one.

## Conventions & gotchas

- Plain JavaScript (ESM), no TypeScript. `@/*` path alias → `src/*` (`jsconfig.json`).
- `custom-server.js` wraps the Next standalone server to derive client IP from the TCP socket and strip attacker-controlled `X-Forwarded-For` — trusting forwarding headers only from a loopback reverse proxy. Preserve this when touching request/IP/rate-limit code.
- Security-sensitive env: `JWT_SECRET` (session cookie), `INITIAL_PASSWORD` (default `123456` — must override), `API_KEY_SECRET`, `MACHINE_ID_SALT`. Full env contract in `.env.example` and ARCHITECTURE.md's env matrix.
- Binary/protobuf upstreams (kiro EventStream, cursor protobuf, commandcode NDJSON) don't round-trip through OpenAI — they're handled inside their own executor, not the translator.
- Upstream merges follow a fixed policy, and it is automated: `.github/workflows/upstream-sync.yml`
  runs daily, and `scripts/upstream-assess.mjs` splits incoming commits into **clean** (touch no
  file this fork has changed — nothing to decide) and **contended** (they do, and each names the
  fork commits that touched the same file). The rule for a contended commit: if upstream already
  handles what our change was for, **take upstream and fix forward from it**, even when it still
  needs work — do not reinstate ours. Only where no official equivalent exists does our version
  win. The job never writes to `inyund`; it opens a PR, because a commit merged on a green tick
  is a commit merged without assessment. Its regression gate is the baseline verifier, not a raw
  pass count — and a clean automerge is not a working one.
- Versioning: root and `cli/` are versioned independently; changes are logged in `CHANGELOG.md` under a `# Unreleased` heading at the top, folded into the version section when a release is cut. Commit style is Conventional Commits (`fix(translator): …`, `feat(...)`).
- Model identity: registry model entries declare `family` / `effort` / `mode` — a band is never inferred from the shape of an id. Read `CONTEXT.md` for the vocabulary and `docs/adr/0001` before touching `tuner/tune.mjs` banding or adding an effort-suffixed model.
- On Windows, set `git config core.fileMode false` in your clone. Windows cannot represent the exec bit, so the default reports `cli/cli.js`, `scripts/translate-readme.js` and `start.sh` as permanently modified (`100755 → 100644`) with zero content change, which blocks `git stash pop` and pollutes every diff. The `100755` modes stay correct in the index either way.
