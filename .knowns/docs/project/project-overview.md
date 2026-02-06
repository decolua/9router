---
title: Project Overview
createdAt: '2026-02-06T08:06:52.728Z'
updatedAt: '2026-02-06T08:10:10.216Z'
description: High-level architecture and operational context for 9router
tags:
  - architecture
  - onboarding
  - project
---
# 9router Overview

## Product purpose
9router provides one OpenAI-compatible endpoint that routes to multiple AI providers (OAuth and API key), supports combo fallback, tracks usage and quotas, and exposes a web dashboard for management.

## Runtime stack
- Node.js 20+
- Next.js App Router (web + API routes): `src/app/**`
- React 19 + Tailwind CSS v4
- Local persistence with LowDB JSON files
- Shared model translation and routing in `open-sse/**`

## Repository structure
- `src/app` - Pages and API routes.
- `src/app/(dashboard)/dashboard/**` - Dashboard screens (providers, endpoint, combos, usage, cli-tools, profile, translator).
- `src/app/api/**` - Backend API endpoints, including OpenAI-compatible `/api/v1/*`.
- `src/sse/**` - Request orchestration, provider credential selection, fallback handling, token refresh.
- `src/lib/localDb.js` - Main DB (provider connections, keys, combos, settings, pricing).
- `src/lib/usageDb.js` - Usage and request logs.
- `src/shared/**` - Reusable UI, constants, hooks, utils, cloud sync services.
- `open-sse/**` - Core translator, chat handling, and provider model definitions.

## Core request flow
1. Client calls `/v1/chat/completions`, `/v1/models`, or `/codex/*`.
2. `next.config.mjs` rewrites these to `src/app/api/v1/**`.
3. Chat endpoint `src/app/api/v1/chat/completions/route.js` initializes translators and calls `handleChat`.
4. `src/sse/handlers/chat.js` resolves model or combo, picks provider credentials, and applies account fallback.
5. `open-sse/handlers/chatCore.js` translates and forwards to target provider.
6. Token refresh and credential updates are persisted via local DB services.
7. Usage and request logs are written by `src/lib/usageDb.js`.

## Auth and access control
- Dashboard routes are protected in `src/proxy.js` by validating `auth_token` JWT cookie.
- Login endpoint: `src/app/api/auth/login/route.js`.
- Settings and password update endpoint: `src/app/api/settings/route.js`.
- OpenAI-compatible API access is handled by stored API keys in local DB.

## Key API groups
- OpenAI-compatible:
  - `src/app/api/v1/chat/completions/route.js`
  - `src/app/api/v1/models/route.js`
  - `src/app/api/v1/responses/route.js`
- Management:
  - providers: `src/app/api/providers/**`
  - provider nodes: `src/app/api/provider-nodes/**`
  - combos: `src/app/api/combos/**`
  - keys: `src/app/api/keys/**`
  - models and aliases: `src/app/api/models/**`
  - usage: `src/app/api/usage/**`
- OAuth and sync:
  - oauth actions: `src/app/api/oauth/**`
  - cloud sync: `src/app/api/sync/**`

## Data storage
- Main DB file: `db.json` under user data directory (or `DATA_DIR` when provided).
- Usage DB file: `usage.json` and rolling `log.txt`.
- Default DB entities include:
  - `providerConnections`
  - `providerNodes`
  - `modelAliases`
  - `combos`
  - `apiKeys`
  - `settings`
  - `pricing`

## Environment and deployment notes
- `next.config.mjs` sets `output: "standalone"` for deployable server bundles.
- Important env vars:
  - `JWT_SECRET`
  - `INITIAL_PASSWORD`
  - `DATA_DIR`
  - `NEXT_PUBLIC_BASE_URL`
  - `NEXT_PUBLIC_CLOUD_URL`
  - `ENABLE_REQUEST_LOGS`
- Root layout imports `@/lib/initCloudSync`, so cloud sync scheduler auto-initializes on server startup.

## Security and operations checklist
- Change default credentials before production.
- Set strong `JWT_SECRET` in production.
- Verify `DATA_DIR` permissions and backup strategy.
- Review enabled providers and API keys regularly.
- Monitor usage and request logs from dashboard.

## Related work
- Task ID: s4v1yv
