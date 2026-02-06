---
title: API Map
createdAt: '2026-02-06T08:16:12.628Z'
updatedAt: '2026-02-06T08:18:51.825Z'
description: Grouped map of 9router API routes and endpoint responsibilities
tags:
  - api
  - architecture
  - onboarding
---
# 9router API Map

## Scope
This map covers Next.js route handlers under `src/app/api/**` and the external endpoint rewrites declared in `next.config.mjs`.

## Routing layer
- `GET|POST /v1/:path*` -> `/api/v1/:path*` (OpenAI-compatible public API).
- `GET /v1` -> `/api/v1`.
- `POST /codex/:path*` -> `/api/v1/responses` (Codex/Responses shortcut).
- `GET|POST /v1/v1/:path*` -> `/api/v1/:path*` (legacy normalization rewrite).

## OpenAI-compatible and protocol endpoints
- `POST /api/v1/chat/completions`: primary chat completion endpoint; initializes translators and routes through SSE handler with fallback.
- `POST /api/v1/responses`: OpenAI Responses API compatibility route using the same core chat pipeline.
- `GET /api/v1/models`: returns OpenAI-style model list from active providers and combo definitions.
- `POST /api/v1/messages`: Claude messages API compatibility endpoint.
- `POST /api/v1/messages/count_tokens`: token-count estimation endpoint used by Claude clients.
- `POST /api/v1/api/chat`: Ollama-style compatibility endpoint (transforms output format).
- `GET /api/v1`: simple fallback model list response.
- `GET /api/v1beta/models`: Gemini-style model listing.
- `POST /api/v1beta/models/[...path]`: Gemini `generateContent` compatibility bridge.

## Auth and session
- `POST /api/auth/login`: verifies password and sets `auth_token` JWT cookie.
- `POST /api/auth/logout`: clears `auth_token` cookie.
- Route protection for dashboard pages is enforced in `src/proxy.js`.

## Settings and runtime control
- `GET|PATCH /api/settings`: read and update runtime settings, including password hash handling.
- `GET /api/init`: trigger module import side effects (cloud sync init hook).
- `POST /api/shutdown`: graceful process shutdown trigger.
- `GET|PATCH|DELETE /api/pricing`: read/update/reset pricing overrides.
- `GET /api/tags`: returns available model tags metadata.

## Provider connection management
- `GET|POST /api/providers`: list and create provider connections.
- `GET|PUT|DELETE /api/providers/[id]`: fetch/update/delete a specific connection.
- `POST /api/providers/[id]/test`: validates OAuth or API-key connection health, includes token refresh logic.
- `GET /api/providers/[id]/models`: fetches provider-native model catalog for a connection.
- `POST /api/providers/validate`: lightweight API key validation before saving.
- `GET /api/providers/client`: internal endpoint that returns provider records with sensitive fields for sync workflows.

## Provider node management (custom compatible backends)
- `GET|POST /api/provider-nodes`: list/create OpenAI-compatible or Anthropic-compatible nodes.
- `PUT|DELETE /api/provider-nodes/[id]`: update/delete provider nodes and keep linked connection metadata aligned.
- `POST /api/provider-nodes/validate`: validates credentials against custom node base URL.

## Model and alias management
- `GET|PUT /api/models`: list model catalog with aliases and update alias entries (legacy alias endpoint).
- `GET|PUT|DELETE /api/models/alias`: canonical alias CRUD for dashboard.
- `GET|PUT /api/cloud/models/alias`: alias operations for cloud/CLI clients authenticated by API key.
- `POST /api/cloud/model/resolve`: resolve alias to provider/model for remote clients.

## API keys and combos
- `GET|POST /api/keys`: list and create local API keys bound to machine identity.
- `DELETE /api/keys/[id]`: delete API key.
- `GET|POST /api/combos`: list/create combo fallback chains.
- `GET|PUT|DELETE /api/combos/[id]`: combo detail update and deletion.

## OAuth and account onboarding
- `GET|POST /api/oauth/[provider]/[action]`: generic OAuth flow handler (authorize, exchange, device-code, poll).
- `GET /api/oauth/kiro/social-authorize`: build Kiro social auth URL.
- `POST /api/oauth/kiro/social-exchange`: exchange Kiro social auth code for tokens.
- `POST /api/oauth/kiro/import`: import Kiro refresh token manually.
- `GET /api/oauth/kiro/auto-import`: auto-detect Kiro token from local AWS SSO cache.
- `GET|POST /api/oauth/cursor/import`: Cursor token import and instruction endpoint.
- `GET /api/oauth/cursor/auto-import`: auto-detect Cursor token from local database.

## Usage and observability
- `GET /api/usage/history`: aggregated usage stats.
- `GET /api/usage/logs`: recent request log lines.
- `GET /api/usage/request-logs`: alternate route for recent request logs.
- `GET /api/usage/[connectionId]`: provider account usage fetch with refresh-on-demand.

## Cloud sync and cloud-side helper APIs
- `POST /api/sync/cloud`: cloud sync actions (`enable`, `sync`, `disable`) and token reconciliation.
- `POST|GET /api/sync/initialize`: initialize and inspect cloud sync scheduler state.
- `POST /api/cloud/auth`: returns active provider credentials and model aliases for remote execution.
- `PUT /api/cloud/credentials/update`: update refreshed provider credentials from remote worker.

## Translator debug endpoints
- `GET /api/translator/load`: load translator debug artifact file.
- `POST /api/translator/save`: save translator debug artifact file.
- `POST /api/translator/translate`: run step-based translation inspection.
- `POST /api/translator/send`: send translated payload directly to provider for debug.

## Related docs

- @doc/project/project-overview
