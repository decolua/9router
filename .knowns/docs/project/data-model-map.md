---
title: Data Model Map
createdAt: '2026-02-06T08:25:02.483Z'
updatedAt: '2026-02-06T08:25:34.667Z'
description: 'LowDB entity schema, relationships, and persistence touchpoints for 9router'
tags:
  - data-model
  - architecture
  - onboarding
---
# 9router Data Model Map

## Scope
This document maps persistence entities in `src/lib/localDb.js` and `src/lib/usageDb.js`, including key fields, relationships, and API touchpoints.

## Storage locations
- Main state database: `db.json` managed by `src/lib/localDb.js`.
- Usage database: `usage.json` managed by `src/lib/usageDb.js`.
- Request log stream: `log.txt` managed by `src/lib/usageDb.js`.
- Local path strategy:
  - `localDb`: `DATA_DIR` env override, otherwise platform user-data path.
  - `usageDb`: platform user-data path based on app name fallback.

## Root schemas
### localDb root (`db.json`)
- `providerConnections: []`
- `providerNodes: []`
- `modelAliases: {}`
- `combos: []`
- `apiKeys: []`
- `settings: { cloudEnabled, stickyRoundRobinLimit, requireLogin, ... }`
- `pricing: {}`

### usageDb root (`usage.json`)
- `history: []`

## Entity: providerConnections
Represents one credential/account binding for a provider (OAuth or API key).

### Identity and lifecycle fields
- `id` (uuid)
- `provider` (provider id)
- `authType` (`oauth` | `apikey`)
- `name`
- `priority` (provider-local selection order)
- `isActive`
- `createdAt`, `updatedAt`

### Common optional fields
- Display and routing: `displayName`, `email`, `globalPriority`, `defaultModel`
- Token/API credentials: `accessToken`, `refreshToken`, `expiresAt`, `expiresIn`, `tokenType`, `scope`, `idToken`, `projectId`, `apiKey`
- Health/fallback: `testStatus`, `lastTested`, `lastError`, `lastErrorAt`, `errorCode`, `rateLimitedUntil`
- Selection counters: `consecutiveUseCount`, `lastUsedAt`
- Provider extension bag: `providerSpecificData` (provider-specific metadata such as baseUrl/apiType/prefix/cached tokens)

### Behavior notes
- Upsert semantics on create:
  - OAuth dedupe by `(provider, email)`.
  - API key dedupe by `(provider, name)`.
- Priority auto-increment if missing; priorities are re-normalized after create/update/delete.
- Cleanup job removes null/undefined optional fields to keep payload compact.

## Entity: providerNodes
Defines custom compatible backend nodes (OpenAI-compatible / Anthropic-compatible).

### Fields
- `id`
- `type`
- `name`
- `prefix`
- `apiType` (for OpenAI-compatible nodes)
- `baseUrl`
- `createdAt`, `updatedAt`

### Behavior notes
- Node `id` is reused as `provider` id in linked `providerConnections`.
- Node updates can propagate `providerSpecificData` updates to linked connections.

## Entity: modelAliases
Map structure from alias to resolved model.

### Canonical structure
- Key: alias string (example: `my-fast-model`)
- Value: model string in provider form (example: `cc/claude-sonnet-4-5-20250929`)

### Usage notes
- Alias resolution is consumed in SSE model service (`src/sse/services/model.js`).
- Alias CRUD is exposed by `/api/models/alias` and `/api/cloud/models/alias`.

## Entity: combos
Fallback chain definition for multi-model routing.

### Fields
- `id` (uuid)
- `name` (unique combo identifier)
- `models: string[]` (ordered fallback list)
- `createdAt`, `updatedAt`

### Usage notes
- Combo name is used as an incoming `model` value.
- `src/sse/services/model.js` resolves combo names and returns model sequence.

## Entity: apiKeys
Local API keys used to authorize OpenAI-compatible requests and cloud helper calls.

### Fields
- `id` (uuid)
- `name`
- `key` (generated format includes machine binding)
- `machineId`
- `createdAt`

### Usage notes
- Validation is exact-key match via `validateApiKey`.
- Key create/delete commonly trigger cloud sync when enabled.

## Entity: settings
Dynamic application and routing controls.

### Known fields
- `cloudEnabled` (boolean)
- `stickyRoundRobinLimit` (number)
- `requireLogin` (boolean)
- Additional runtime fields may be merged over time (for example password hash and fallback strategy).

### Usage notes
- Read by auth and fallback selection logic.
- Updated through `/api/settings` and cloud sync workflows.

## Entity: pricing
User overrides for model cost tables.

### Structure
- `pricing[provider][model] = { input, output, cached?, reasoning?, cache_creation? }`

### Usage notes
- `getPricing()` merges defaults with user overrides.
- `usageDb` cost computation reads `getPricingForModel(provider, model)`.

## Entity: usage.history
Append-only usage records for completed requests.

### Expected entry shape
- `provider`
- `model`
- `tokens` object (supports multiple token field variants)
- `connectionId` (optional)
- `timestamp` (auto-filled if missing)

### Aggregation outputs
`getUsageStats()` derives:
- Totals: requests, prompt/completion tokens, cost
- Grouping: `byProvider`, `byModel`, `byAccount`
- Time buckets: `last10Minutes`
- In-memory state projection: `pending`, `activeRequests`

## Ephemeral in-memory state (not persisted)
- `pendingRequests` in `usageDb`:
  - `byModel`
  - `byAccount`
- Updated via `trackPendingRequest(...)` while requests are in-flight.

## Cross-entity relationships
- `providerNodes.id` -> `providerConnections.provider` (for compatible node-based providers).
- `providerConnections.id` -> `usage.history[].connectionId` (usage attribution to account).
- `modelAliases` influences routing for single model selection.
- `combos.name` influences routing for multi-step fallback selection.
- `apiKeys` gates API and cloud helper access paths.
- `settings.cloudEnabled` controls whether mutations trigger cloud sync pipelines.

## Data flow touchpoints
- Provider credential lifecycle:
  - Create/update/delete via `/api/providers/**`.
  - Health and token refresh via `/api/providers/[id]/test` and SSE token refresh helpers.
  - Optional overwrite from cloud reconciliation in `/api/sync/cloud`.
- Alias/combo/key updates:
  - `/api/models/alias`, `/api/combos`, `/api/keys` mutate root entities and may sync to cloud.
- Usage ingestion and reporting:
  - `usageDb.saveRequestUsage` appends records.
  - `/api/usage/history`, `/api/usage/logs`, `/api/usage/[connectionId]` expose summaries and provider usage.

## Integrity and migration considerations
- Optional fields are intentionally sparse and may be absent.
- `settings` and `providerSpecificData` are open-ended maps; callers must handle unknown keys.
- Alias semantics differ across legacy code paths; prefer alias map as `alias -> model` (see `/api/models/alias`).
- Cloud reconciliation currently favors newer `updatedAt` values per provider connection.

## Related docs
- @doc/project/project-overview
- @doc/project/api-map
- Task ID: 6ugz46
