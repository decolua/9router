# 9Router Architecture

_Last updated: 2026-06-02_

## Executive Summary

9Router is a local AI routing gateway and dashboard built on Next.js.
It provides a single OpenAI-compatible endpoint (`/v1/*`) and routes traffic across multiple upstream providers with translation, fallback, token refresh, and usage tracking.

Core capabilities:

- OpenAI-compatible API surface for CLI/tools
- Request/response translation across provider formats
- Model combo fallback (multi-model sequence)
- Account-level fallback (multi-account per provider)
- OAuth + API-key provider connection management
- Local persistence for providers, keys, aliases, combos, settings, pricing
- Usage/cost tracking and request logging
- Optional cloud sync for multi-device/state sync
- RTK Token Saver (20-40% input token savings)
- Caveman Mode (up to 65% output token savings)
- Speech-to-Text (STT), Text-to-Speech (TTS), Image Generation, Web Search, Web Fetch endpoints
- MCP Marketplace for plugin management
- Tailscale tunnel integration
- Skills system for custom AI workflows

Primary runtime model:

- Next.js app routes under `src/app/api/*` implement both dashboard APIs and compatibility APIs
- A shared SSE/routing core in `src/sse/*` + `open-sse/*` handles provider execution, translation, streaming, fallback, and usage


## Local Fork Boundaries

This workspace is the local `diepxuan/9router` fork. It is operated locally and does not create PRs against upstream `decolua/9router`.

Fork-only customizations should stay under:

- `src/diepxuan/**`
- `open-sse/diepxuan/**`

Base-source changes should be limited to small hooks/bridges with safe fallback. If a fork module fails, the base 9Router runtime should continue without breaking upstream-compatible behavior.

## Scope and Boundaries

### In Scope

- Local gateway runtime
- Dashboard management APIs
- Provider authentication and token refresh
- Request translation and SSE streaming
- Local state + usage persistence
- Optional cloud sync orchestration
- RTK compression filters
- STT/TTS/Image/Search/Fetch proxy endpoints
- MCP plugin management
- Tailscale tunnel

### Out of Scope

- Cloud service implementation behind `NEXT_PUBLIC_CLOUD_URL`
- Provider SLA/control plane outside local process
- External CLI binaries themselves (Claude CLI, Codex CLI, etc.)

## High-Level System Context

```
┌──────────────────────────────────────────────────────────────────┐
│                        Developer Clients                          │
│  Claude Code │ Codex │ OpenClaw │ Cursor │ Cline │ Custom Tools   │
│                        Browser Dashboard                         │
└─────────────────────────┬────────────────────────────────────────┘
                          │ http://localhost:20128/v1
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│                       9Router Gateway                             │
│                                                                   │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────────┐  │
│  │ V1 Compat   │  │ Management   │  │ RTK Token Saver         │  │
│  │ /v1/*       │  │ /api/*       │  │ open-sse/rtk/*          │  │
│  └──────┬──────┘  └──────┬───────┘  └────────────┬────────────┘  │
│         │                │                        │               │
│  ┌──────┴────────────────┴────────────────────────┴──────────┐  │
│  │              SSE + Translation Core                        │  │
│  │  src/sse/* │ open-sse/* │ open-sse/executors/*            │  │
│  └──────┬────────────────────────────────────────────────────┘  │
│         │                                                       │
│  ┌──────┴──────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ SQLite DB       │  │ Tailscale    │  │ MCP Plugins      │   │
│  │ src/lib/db/*    │  │ Tunnel       │  │ Marketplace      │   │
│  └─────────────────┘  └──────────────┘  └──────────────────┘   │
└─────────────────────────┬───────────────────────────────────────┘
                          │
          ┌───────────────┼────────────────┐
          ▼               ▼                ▼
   ┌────────────┐  ┌─────────────┐  ┌─────────────┐
   │ OAuth      │  │ API Key     │  │ Custom      │
   │ Providers  │  │ Providers   │  │ Nodes       │
   │ (10+)      │  │ (40+)       │  │ (Ollama...) │
   └────────────┘  └─────────────┘  └─────────────┘
```

## Core Runtime Components

### 1) API and Routing Layer (Next.js App Routes)

Main directories:

- `src/app/api/v1/*` and `src/app/api/v1beta/*` for compatibility APIs
- `src/app/api/*` for management/configuration APIs
- Next rewrites in `next.config.mjs` map `/v1/*` to `/api/v1/*`

Important compatibility routes:

- `src/app/api/v1/chat/completions/route.js` — main chat endpoint
- `src/app/api/v1/responses/route.js` — OpenAI Responses format
- `src/app/api/v1/models/route.js` — list available models
- `src/app/api/v1/messages/count_tokens/route.js` — token counting
- `src/app/api/v1beta/models/*` — v1beta model discovery

Extended endpoints (v0.4.18+):

- `src/app/api/v1/audio/transcriptions` — STT (Speech-to-Text)
- `src/app/api/v1/audio/speech` — TTS (Text-to-Speech)
- `src/app/api/v1/images/generations` — Image generation
- `src/app/api/v1/search` — Web search
- `src/app/api/v1/web/fetch` — Web fetch (URL → markdown)

Management APIs:

| Route | Purpose |
|-------|---------|
| `/api/auth/*` | Login/logout, session management |
| `/api/settings/*` | App settings (auth, sync, etc.) |
| `/api/providers*` | Provider CRUD, validation, testing |
| `/api/provider-nodes*` | Custom compatible node management |
| `/api/oauth/*` | OAuth/device-code flows |
| `/api/keys*` | API key lifecycle |
| `/api/models/*` | Model aliases, disabled models, info |
| `/api/combos*` | Fallback combo management |
| `/api/pricing` | Pricing overrides |
| `/api/usage/*` | Usage statistics and logs |
| `/api/sync/*` | Cloud sync control |
| `/api/cloud/*` | Cloud-facing helpers |
| `/api/cli-tools/*` | Local CLI config writers |
| `/api/proxy-pools` | Proxy pool management |
| `/api/health` | Health check |
| `/api/version` | Version info |
| `/api/shutdown` | Graceful shutdown |
| `/api/tags` | Tag management |

### 2) SSE + Translation Core

Main flow modules:

- Entry: `src/sse/handlers/chat.js`
- Core orchestration: `open-sse/handlers/chatCore.js`
- Provider execution adapters: `open-sse/executors/*`
- Format detection/provider config: `open-sse/services/provider.js`
- Model parse/resolve: `src/sse/services/model.js`, `open-sse/services/model.js`
- Account fallback logic: `open-sse/services/accountFallback.js`
- Translation registry: `open-sse/translator/index.js`
- Stream transformations: `open-sse/utils/stream.js`, `open-sse/utils/streamHandler.js`
- Usage extraction/normalization: `open-sse/services/usage.js`
- Token refresh: `open-sse/services/tokenRefresh.js`, `src/sse/services/tokenRefresh.js`
- RTK compression: `open-sse/rtk/*`
- Combo handling: `open-sse/services/combo.js`

### 3) Persistence Layer

#### SQLite Database (v0.4.25+)

Migrated from lowdb (`db.json`) to SQLite with modular repository pattern:

```
src/lib/db/
├── adapters/          # better-sqlite3 (primary) + sql.js (fallback)
├── backup.js          # DB backup/restore utilities
├── driver.js          # SQLite driver abstraction
├── helpers/           # SQL helpers and utilities
├── index.js           # DB initialization and exports
├── migrate.js         # Migration runner
├── migrations/        # Versioned SQL migrations
├── paths.js           # DB file path resolution
├── repos/             # Repository pattern implementations
│   ├── providers.js
│   ├── keys.js
│   ├── combos.js
│   ├── aliases.js
│   ├── settings.js
│   ├── pricing.js
│   ├── nodes.js
│   └── ...
├── schema.js          # Table definitions
└── version.js         # DB version tracking
```

Legacy compatibility:

- `src/lib/localDb.js` — thin wrapper over SQLite for backward compatibility
- `src/lib/usageDb.js` — usage stats wrapper

Usage DB:

- `src/lib/usage/*` — request usage persistence
- `src/lib/requestDetailsDb.js` — per-request detail storage

### 4) Auth + Security Surfaces

- Dashboard cookie auth: `src/app/api/auth/login/route.js`
- API key generation/verification: `src/shared/utils/apiKey.js`
- Provider secrets persisted in SQLite `provider_connections` table
- Optional proxy support via `open-sse/utils/proxyFetch.js`

### 5) Cloud Sync

- Scheduler init: `src/lib/initCloudSync.js`
- Periodic task: `src/shared/services/cloudSyncScheduler.js`
- Control route: `src/app/api/sync/cloud/route.js`

### 6) RTK Token Saver

```
open-sse/rtk/
├── applyFilter.js     # Apply compression filter to content
├── autodetect.js      # Auto-detect tool_result type from first 1KB
├── caveman.js         # Caveman mode filter
├── cavemanPrompts.js  # Caveman prompt templates
├── constants.js       # Filter constants
├── filters/           # Individual filter implementations
│   ├── gitDiff.js
│   ├── gitStatus.js
│   ├── grep.js
│   ├── find.js
│   ├── ls.js
│   ├── tree.js
│   ├── dedupLog.js
│   ├── smartTruncate.js
│   ├── readNumbered.js
│   └── searchList.js
├── index.js           # RTK entry point
└── registry.js        # Filter registry
```

Filters: `git-diff`, `git-status`, `grep`, `find`, `ls`, `tree`, `dedup-log`, `smart-truncate`, `read-numbered`, `search-list`

### 7) Speech-to-Text / Text-to-Speech (v0.4.18+)

```
src/sse/handlers/
├── stt.js             # STT request handler
├── tts.js             # TTS request handler
├── embeddings.js      # Embeddings handler
├── imageGeneration.js # Image generation handler
├── search.js          # Web search handler
└── fetch.js           # Web fetch handler

open-sse/handlers/
├── sttCore.js         # STT pipeline orchestration
├── ttsCore.js         # TTS pipeline orchestration
├── ttsProviders/      # TTS provider implementations
└── ...

open-sse/translator/
├── request/           # Request translators (openai, claude, gemini, etc.)
└── response/          # Response translators
```

STT providers: OpenAI Whisper, Groq, Gemini, Deepgram, AssemblyAI, HuggingFace, NVIDIA Parakeet
TTS providers: OpenAI, ElevenLabs, Deepgram, Edge TTS, Google TTS, Hyperbolic, Inworld

### 8) Extended Endpoints (v0.4.18+)

| Endpoint | Handler | Description |
|----------|---------|-------------|
| `/v1/audio/transcriptions` | `stt.js` / `sttCore.js` | Speech-to-Text |
| `/v1/audio/speech` | `tts.js` / `ttsCore.js` | Text-to-Speech |
| `/v1/audio/voices` | API route | List available TTS voices |
| `/v1/images/generations` | `imageGeneration.js` | Image generation (incl. Cloudflare Workers AI) |
| `/v1/search` | `search.js` | Web search |
| `/v1/web/fetch` | `fetch.js` | Web fetch (URL → markdown) |
| `/v1/models/info` | API route | Model metadata |

### 9) Tailscale Tunnel (v0.4.25+)

- Status check API for tunnel connectivity
- Configurable tunnel transport protocols
- Auto-resume guard (once-per-process)

### 10) MCP Marketplace (v0.4.25+)

- MCP plugin management via dashboard modal
- Plugin discovery and activation
- Integrated with Cowork Tool Card

## Request Lifecycle (`/v1/chat/completions`)

```
Client POST /v1/chat/completions
  → Route: /api/v1/chat/completions
    → Handler: src/sse/handlers/chat.js
      → Model Resolver: parse/resolve model or combo
        → Combo? → iterate combo models
        → Auth: getProviderCredentials(provider)
          → SSE Core: open-sse/handlers/chatCore.js
            → Detect source format (openai/claude/gemini/openai-responses)
            → Translate request to target format
            → RTK: compress tool_results before sending
            → Executor: open-sse/executors/{provider}.js
              → Upstream API call
              → 401/403? → refreshCredentials() → retry
            ← SSE/JSON response
            → Translate stream to client format
            → Extract usage → persist to DB
            ← SSE chunks / JSON response to client
```

## Combo + Account Fallback Flow

```
Incoming model string
  → Is combo name?
    Yes → Load combo models sequence
    No  → Single model path
  → Resolve provider/model
  → Select account credentials
    → Credentials available?
      No  → Return provider unavailable
      Yes → Execute request (with RTK compression)
        → Success? → Return response
        → Error:
          → Fallback-eligible?
            No  → Return error
            Yes → Mark account cooldown
              → Another account for provider?
                Yes → Retry with next account
                No  → Next combo model?
                  Yes → Try next model
                  No  → Return all unavailable
```

Fallback decisions driven by `open-sse/services/accountFallback.js` using status codes and error-message heuristics.

## OAuth Onboarding and Token Refresh Lifecycle

```
Dashboard UI → /api/oauth/[provider]/[action]
  → GET authorize or device-code
    → Provider Auth Server → auth URL or device code
  → POST exchange or poll
    → Token exchange/poll → access/refresh tokens
    → CreateProviderConnection(oauth data)

Live traffic:
  → open-sse/handlers/chatCore.js
    → 401/403 detected
      → executor.refreshCredentials()
        → Retry with updated tokens
```

## Data Model and Storage Map

### SQLite Tables (v0.4.25+)

| Table | Purpose |
|-------|---------|
| `provider_connections` | Auth credentials, status, rate limits |
| `provider_nodes` | Custom compatible endpoints |
| `model_aliases` | Model name aliases |
| `combos` | Fallback model sequences |
| `api_keys` | Local API key lifecycle |
| `settings` | App configuration |
| `pricing` | Pricing overrides |
| `disabled_models` | Disabled model list |
| `usage_entries` | Request usage history |
| `tags` | Resource tagging |
| `proxy_pools` | Proxy configuration |

Physical storage files:

- SQLite DB: `${DATA_DIR}/9router.db` (or `~/.9router/9router.db`)
- Usage stats: `~/.9router/usage.json`
- Request logs: `~/.9router/log.txt`
- Optional debug logs: `<repo>/logs/...`

## Deployment Topology

```
┌──────────────────────────────────────────────────────┐
│                     Developer Host                    │
│                                                       │
│  ┌────────────┐    ┌──────────────────────┐          │
│  │ CLI Tools  │───→│  9Router (Next.js)   │          │
│  │ Browser    │───→│  PORT=20128          │          │
│  └────────────┘    │                      │          │
│                    │  ┌────────────────┐  │          │
│                    │  │ SSE Core       │  │          │
│                    │  │ + RTK + Trans  │  │          │
│                    │  └───────┬────────┘  │          │
│                    │  ┌───────┴────────┐  │          │
│                    │  │ SQLite DB      │  │          │
│                    │  │ (db/)          │  │          │
│                    │  └────────────────┘  │          │
│                    │  ┌────────────────┐  │          │
│                    │  │ Tailscale      │  │          │
│                    │  │ MCP Plugins    │  │          │
│                    │  └────────────────┘  │          │
│                    └──────────┬───────────┘          │
└───────────────────────────────┼──────────────────────┘
                                │
            ┌───────────────────┼──────────────────┐
            ▼                   ▼                  ▼
     ┌────────────┐    ┌─────────────┐    ┌─────────────┐
     │ OAuth      │    │ API Key     │    │ Custom      │
     │ Providers  │    │ Providers   │    │ Nodes       │
     │ (10+)      │    │ (40+)       │    │ (Ollama...) │
     └────────────┘    └─────────────┘    └─────────────┘
            │                   │                  │
            └───────────────────┼──────────────────┘
                                ▼
                       ┌────────────────┐
                       │ Cloud Sync     │
                       │ (Optional)     │
                       └────────────────┘
```

## Module Mapping (Decision-Critical)

### Route and API Modules

- `src/app/api/v1/*`, `src/app/api/v1beta/*`: compatibility APIs
- `src/app/api/providers*`: provider CRUD, validation, testing
- `src/app/api/provider-nodes*`: custom compatible node management
- `src/app/api/oauth/*`: OAuth/device-code flows
- `src/app/api/keys*`: local API key lifecycle
- `src/app/api/models/alias`: alias management
- `src/app/api/combos*`: fallback combo management
- `src/app/api/pricing`: pricing overrides
- `src/app/api/usage/*`: usage and logs APIs
- `src/app/api/sync/*` + `src/app/api/cloud/*`: cloud sync
- `src/app/api/cli-tools/*`: local CLI config writers/checkers
- `src/app/api/proxy-pools`: proxy pool management
- `src/app/api/settings/*`: app settings
- `src/app/api/health`: health check

### Routing and Execution Core

- `src/sse/handlers/chat.js`: request parse, combo handling, account selection
- `open-sse/handlers/chatCore.js`: translation, executor dispatch, retry/refresh
- `open-sse/executors/*`: provider-specific network and format behavior

### Translation Registry and Format Converters

- `open-sse/translator/index.js`: translator registry and orchestration
- Request translators: `open-sse/translator/request/*`
- Response translators: `open-sse/translator/response/*`
- Format constants: `open-sse/translator/formats.js`

### Persistence

- `src/lib/db/*`: SQLite database layer (adapters, repos, migrations, schema)
- `src/lib/localDb.js`: backward-compatible wrapper
- `src/lib/usageDb.js`: usage history wrapper
- `src/lib/requestDetailsDb.js`: per-request details

### RTK Token Saver

- `open-sse/rtk/index.js`: entry point
- `open-sse/rtk/autodetect.js`: auto-detect content type
- `open-sse/rtk/applyFilter.js`: apply compression
- `open-sse/rtk/filters/*`: individual filter implementations
- `open-sse/rtk/caveman.js`: Caveman mode

## Provider Executor Coverage

Specialized executors:

| Executor | Provider |
|----------|----------|
| `antigravity.js` | Antigravity |
| `codex.js` | Codex |
| `commandcode.js` | CommandCode |
| `cursor.js` | Cursor |
| `gemini-cli.js` | Gemini CLI |
| `github.js` | GitHub |
| `kiro.js` | Kiro |
| `ollama-local.js` | Local Ollama |
| `opencode.js` | OpenCode |
| `opencode-go.js` | OpenCode Go |
| `perplexity-web.js` | Perplexity Web |
| `qoder.js` | Qoder |
| `qwen.js` | Qwen |
| `vertex.js` | Vertex AI |
| `azure.js` | Azure |
| `grok-web.js` | Grok Web |
| `iflow.js` | iFlow |

Default executor:

- All other providers use `open-sse/executors/default.js`

## Format Translation Coverage

Detected source formats:

- `openai`
- `openai-responses`
- `claude`
- `gemini`

Target formats:

- OpenAI chat/Responses
- Claude
- Gemini/Gemini-CLI/Antigravity envelope
- Kiro
- Cursor
- Vertex
- Cursor IDE

Translations selected dynamically based on source payload shape and provider target format.

## Failure Modes and Resilience

### 1) Account/Provider Availability

- Provider account cooldown on transient/rate/auth errors
- Account fallback before failing request
- Combo model fallback when current model/provider path is exhausted

### 2) Token Expiry

- Pre-check and refresh for refreshable providers
- 401/403 retry after refresh attempt in core path
- In-flight request caching to prevent race conditions (v0.4.14+)

### 3) Stream Safety

- Disconnect-aware stream controller
- Translation stream with end-of-stream flush and `[DONE]` handling
- Usage estimation fallback when provider usage metadata is missing

### 4) Cloud Sync Degradation

- Sync errors surfaced but local runtime continues
- Scheduler has retry-capable logic

### 5) Data Integrity

- SQLite schema migrations for backward compatibility
- DB backup/restore utilities (`src/lib/db/backup.js`)
- Corrupt JSON reset safeguards for legacy files

### 6) RTK Safety

- If a filter fails, throws, or makes output bigger → silently keep original
- Errors never break requests
- Runs before format translation (universal compatibility)

## Observability and Operational Signals

Runtime visibility:

- Console logs from `src/sse/utils/logger.js`
- Per-request usage in `usage.json` / SQLite
- Textual request status log in `log.txt`
- Deep request/translation logs under `logs/` when `ENABLE_REQUEST_LOGS=true`
- Dashboard usage endpoints (`/api/usage/*`)
- Health check (`/api/health`)

## Security-Sensitive Boundaries

- JWT secret (`JWT_SECRET`) — dashboard session cookie signing
- Initial password fallback (`INITIAL_PASSWORD`, default `123456`) — override in production
- API key HMAC secret (`API_KEY_SECRET`) — API key generation
- Provider secrets persisted in SQLite — protect at filesystem level
- Cloud sync uses API key auth + machine ID

## Environment and Runtime Matrix

| Variable | Purpose |
|----------|---------|
| `PORT` | Server port (default: 20128) |
| `HOSTNAME` | Bind address (default: localhost) |
| `NEXT_PUBLIC_BASE_URL` | Dashboard base URL |
| `DATA_DIR` | SQLite DB directory |
| `JWT_SECRET` | Dashboard session signing |
| `INITIAL_PASSWORD` | Default admin password |
| `API_KEY_SECRET` | API key HMAC secret |
| `MACHINE_ID_SALT` | Machine ID generation |
| `ENABLE_REQUEST_LOGS` | Enable detailed logging |
| `NEXT_PUBLIC_CLOUD_URL` | Cloud sync endpoint |
