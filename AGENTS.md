# AGENTS.md

Compact instruction file for OpenCode sessions working on 9Router.

## Project Overview

9Router is an AI infrastructure manager / API gateway built with Next.js 16. It routes requests to multiple AI providers, handles authentication, tracks usage, and provides a web dashboard. The app includes tunneling (Cloudflare, Tailscale), MITM proxy capabilities, and SQLite-based persistence.

## Architecture

- **Next.js app** (`src/app/`) - Dashboard UI and API routes
- **open-sse/** - Standalone library for provider translation, request/response format conversion, and model resolution
- **src/lib/** - Database layer, tunnel management, OAuth, network utilities
- **src/shared/** - Shared components, hooks, services, constants
- **src/mitm/** - MITM proxy server for DNS-based interception
- **src/server-init.js** - Server initialization entrypoint

Path aliases:
- `@/*` → `./src/*`
- `open-sse` → `./open-sse`

## Development Commands

```bash
# Development (port 20128)
npm run dev

# Production build
npm run build
npm start

# Bun variants (faster)
npm run dev:bun
npm run build:bun
npm run start:bun
```

Port is hardcoded to **20128** in all scripts.

## Database Layer

**4-tier fallback**: bun:sqlite (Bun) → better-sqlite3 → node:sqlite (Node ≥22.5) → sql.js (WASM)

- Driver selection happens at runtime in `src/lib/db/driver.js`
- Migrations in `src/lib/db/migrations/`
- Repos pattern in `src/lib/db/repos/` (accounts, keys, settings, usage, etc.)
- Main entry: `src/lib/localDb.js`

**Important**: better-sqlite3 is in `optionalDependencies` so npm install doesn't fail on systems without build tools. The app falls back to sql.js at runtime if native build is unavailable.

## Docker

- Multi-stage build (builder + runner)
- Runs as root (entrypoint.sh does not drop privileges)
- Copies `open-sse/`, `src/mitm/`, `src/shared/`, `src/lib/` into standalone output
- Manually copies `better-sqlite3`, `sql.js`, `node-forge` node_modules for runtime
- Data dir: `/app/data`
- Port: 20128

Build and run:
```bash
./start.sh
# or manually:
docker build -t 9router .
docker run -d --name 9router -p 20128:20128 --env-file .env -v 9router-data:/app/data 9router
```

## Server Initialization

`src/server-init.js` → `src/shared/services/initializeApp.js`

On startup (`src/server-init.js` -> `src/shared/services/initializeApp.js`):
1. Cleans up stale provider connections
2. Auto-resumes tunnel (Cloudflare) if `tunnelEnabled` in settings
3. Auto-resumes Tailscale if `tailscaleEnabled` in settings
4. Registers signal handlers (SIGINT/SIGTERM) to cleanup DNS entries, kill cloudflared
5. Starts MITM proxy if enabled
6. Starts watchdog and network monitor intervals

## Tunnel & MITM

- **Cloudflare tunnel**: `src/lib/tunnel/cloudflared.js`, `src/lib/tunnel/tunnelManager.js`
- **Tailscale**: `src/lib/tunnel/tailscale.js`
- **MITM proxy**: `src/mitm/manager.js`, `src/mitm/server.js`
  - DNS-based interception for local tools
  - Requires encrypted password stored in DB
  - Cleanup on exit removes DNS entries
- **Custom domain tunnel**: Cloudflare Worker in `cloudflare/worker/` provides stable public URLs like `https://r{shortId}.yourdomain.com`
  - See `docs/CUSTOM_DOMAIN_TUNNEL.md` for setup
  - Worker registers/temp-url rotation automatically

## open-sse Library

Standalone module for AI provider integration:
- **config/providers.js** - Provider definitions
- **config/providerModels.js** - Model mappings and aliases
- **translator/** - Request/response format translation (OpenAI ↔ Anthropic ↔ Gemini, etc.)
- **services/provider.js** - Provider URL/header building, format detection
- **services/model.js** - Model parsing and alias resolution
- **services/accountFallback.js** - Account availability and cooldown logic
- **executors/** - Provider-specific request executors (Ollama local, etc.)

Exports are in `open-sse/index.js`.

## Testing

No test framework currently configured. If adding tests, use standard Next.js patterns (Jest or Vitest).

## Linting & Formatting

- ESLint with `eslint-config-next`
- Tailwind CSS v4 with PostCSS
- No TypeScript (JavaScript with JSDoc via jsconfig.json)

Run lint:
```bash
npx eslint .
```

## Git Workflow

- Main branch: `master`
- Origin: `https://github.com/kiprox/9router.git`
- Upstream: `https://github.com/decolua/9router.git`

## Deployment

- **Docker**: Use `start.sh` or Dockerfile
- **Caprover**: `captain-definition` present

## Environment

- `NODE_ENV=production` for builds
- `DATA_DIR` for data persistence (default `/app/data` in Docker)
- `NEXT_TELEMETRY_DISABLED=1` in Docker
- `MITM_SERVER_PATH` injected at runtime by initializeApp.js
- `PUBLIC_DOMAIN` (or `TUNNEL_PUBLIC_DOMAIN`) to override default `9router.com` for tunnel URLs like `https://r{shortId}.yourdomain.com`

## Common Gotchas

- **Port 20128** is hardcoded everywhere
- **better-sqlite3** may not build on all systems; app falls back to sql.js automatically
- **Webpack mode** is forced (`--webpack` flag) in all dev/build scripts
- **Logs directory** is ignored by webpack watchOptions to prevent HMR loops during streaming
- **MITM server path** must be injected before starting MITM (handled in initializeApp.js)
- **Tunnel auto-resume** happens once per process on startup if enabled in settings
- **Signal handlers** registered globally to cleanup DNS and cloudflared on exit
- **Next.js standalone output** requires manual copying of `open-sse/`, `src/mitm/`, `src/shared/`, `src/lib/` in Dockerfile

## Key Files to Check First

When investigating issues:
1. `src/shared/services/initializeApp.js` - Startup logic
2. `src/lib/db/driver.js` - Database driver selection
3. `open-sse/index.js` - Provider library exports
4. `next.config.mjs` - Next.js config, rewrites, webpack overrides
5. `src/lib/localDb.js` - Main database interface
