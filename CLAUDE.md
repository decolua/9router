# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Root app (Next.js dashboard + API)
- Install: `npm install`
- Dev (port 20128): `npm run dev`
- Build: `npm run build`
- Start prod: `npm run start`
- Bun variants: `npm run dev:bun`, `npm run build:bun`, `npm run start:bun`

Common local run env (from README):
- `PORT=20128 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run dev`

### Cloud worker (`cloud/`)
- Install: `cd cloud && npm install`
- Dev: `npm run dev`
- Deploy: `npm run deploy`

Typical setup uses Wrangler KV + D1 migration:
- `wrangler login`
- `wrangler kv namespace create KV`
- `wrangler d1 create proxy-db`
- `wrangler d1 execute proxy-db --remote --file=./migrations/0001_init.sql`

### Tests (`tests/`, Vitest)
- Install: `cd tests && npm install`
- All tests: `npm test`
- Watch: `npm run test:watch`
- Single file:
  - `NODE_PATH=/tmp/node_modules /tmp/node_modules/.bin/vitest run unit/embeddingsCore.test.js --reporter=verbose --config ./vitest.config.js`

## Big-picture architecture

9Router is a local-first AI router exposing an OpenAI-compatible endpoint (`/v1`) plus a web dashboard.

Request flow:
1. Client tools call `http://localhost:20128/v1`.
2. Router normalizes/translates payloads and applies combo/fallback routing.
3. Provider auth/token refresh and account selection are handled per integration.
4. Compatible response/stream is returned; usage/quota is tracked.

Main parts:
- **Root Next.js app**: dashboard UI + server routes (including `/v1`).
- **Routing/translation layer**: OpenAI-style interface to provider-specific behavior.
- **Persistence**: file-based local state (LowDB JSON) for providers/combos/settings/keys; separate usage/log storage.
- **`cloud/` worker**: Cloudflare Worker path for cloud deployment/sync scenarios.
- **`tests/` project**: embeddings-focused Vitest suite (`/v1/embeddings` core + cloud handler behavior).

## Important repo notes

- Default dashboard: `http://localhost:20128/dashboard`
- Default API base: `http://localhost:20128/v1`
- Docs indicate preferring server-side `BASE_URL` and `CLOUD_URL` for cloud runtime behavior.
- No `.cursor/rules/`, `.cursorrules`, or `.github/copilot-instructions.md` currently present.
