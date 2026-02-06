---
title: State Machine Map
createdAt: '2026-02-06T08:28:38.182Z'
updatedAt: '2026-02-06T08:29:16.688Z'
description: >-
  Provider account lifecycle states, transitions, and code touchpoints for
  routing and operations
tags:
  - state-machine
  - ops
  - architecture
---
# 9router State Machine Map

## Scope
This document maps provider-account lifecycle states used by routing, fallback, token refresh, and dashboard status rendering.

## Primary entity under state control
State is carried on each `providerConnections[]` record in `db.json` (`src/lib/localDb.js`) and interpreted by routing code in `src/sse/**` plus UI in `src/app/(dashboard)/dashboard/providers/**`.

## State fields
- `testStatus`: operational status marker (`unknown`, `active`, `success`, `error`, `expired`, `unavailable`, etc.).
- `rateLimitedUntil`: cooldown-until timestamp; account is unavailable while this is in the future.
- `lastError`, `lastErrorAt`, `errorCode`: latest failure context.
- `isActive`: manual enable/disable switch from dashboard.
- `expiresAt`: token expiry boundary for proactive or reactive refresh flows.
- `lastUsedAt`, `consecutiveUseCount`: scheduling state for round-robin strategy.

## Canonical lifecycle states
### 1) `unknown`
- Typical entry: newly created API-key connection before first validation.
- Producer touchpoint: `/api/providers` create path sets default `testStatus` to `unknown` when no explicit status is passed.
- Transition out: explicit connection test or successful request path eventually moves to active/success or error.

### 2) `active`
- Meaning: account is eligible for selection and considered healthy.
- Entry triggers:
  - successful connection test (`/api/providers/[id]/test`)
  - manual/automatic error clearing (`clearAccountError`)
  - token refresh callbacks that mark account usable
  - cooldown expiration interpreted by UI as effectively active
- Exit triggers: fallback-classified failures mark account unavailable or error.

### 3) `success`
- Meaning: legacy/alternate healthy state used by some UI/API paths.
- Treated as healthy in provider list calculations and combo provider filtering.
- Often normalized operationally alongside `active`.

### 4) `error`
- Meaning: validation failed or provider request failed without a temporary cooldown branch.
- Entry trigger: connection test endpoint sets `testStatus = error` and stores `lastError`.
- Exit trigger: next successful test or successful request path can clear errors and return to active.

### 5) `unavailable` (cooldown state)
- Meaning: account should be skipped for a cooldown period.
- Entry trigger: runtime fallback logic calls `markAccountUnavailable(...)`.
- Stored side effects:
  - `testStatus = unavailable`
  - `rateLimitedUntil = now + cooldownMs`
  - error metadata updated (`lastError`, `lastErrorAt`, `errorCode`)
- Exit behavior:
  - routing filter automatically re-allows account after `rateLimitedUntil` expires
  - UI computes `effectiveStatus = active` when cooldown expired even if stored status remains unavailable
  - successful request can persistently clear error fields via `clearAccountError(...)`.

### 6) `expired`
- Meaning: account token considered expired by test/UI conventions.
- Generally appears in UI handling and compatibility paths; refresh logic often transitions through active/error instead of persisting expired for long.

### 7) `disabled` (derived)
- Not a stored `testStatus` value; represented by `isActive = false`.
- Excluded from active credential selection (`getProviderConnections({ isActive: true })`).
- Dashboard shows disabled regardless of health state.

## Transition triggers and guard logic
### A) Selection guard (routing pre-check)
- `getProviderCredentials(...)` filters accounts by:
  - `isActive === true`
  - not excluded in current retry cycle
  - `!isAccountUnavailable(rateLimitedUntil)`
- Strategy branch:
  - `fill-first`: choose smallest priority.
  - `round-robin`: use `lastUsedAt` + `consecutiveUseCount` and `stickyRoundRobinLimit` from settings.

### B) Runtime failure -> cooldown/unavailable
- In `src/sse/handlers/chat.js`, failed provider responses are evaluated by `checkFallbackError(status, error)`.
- When fallback is warranted:
  - account marked unavailable via `markAccountUnavailable(...)`
  - request retries on next eligible account.

### C) Cooldown policy matrix
Defined in `open-sse/services/accountFallback.js` and constants in `open-sse/config/constants.js`.
- 401 -> unauthorized cooldown
- 402/403 -> payment/permission cooldown
- 404 -> model-not-found cooldown
- 429 -> exponential backoff cooldown (`BACKOFF_CONFIG`)
- 408/500/502/503/504 -> transient cooldown
- message-pattern overrides (for example `request not allowed`, quota/rate terms)

### D) Success path -> recovery to active
- On successful provider request, callback `onRequestSuccess` runs `clearAccountError(...)`.
- This clears `testStatus` and error metadata when needed.
- Effectively transitions account from unavailable/error back to active.

### E) Token-expiry paths
1. Proactive refresh:
   - before request, `checkAndRefreshToken(...)` inspects `expiresAt` against buffer and refreshes if needed.
2. Reactive refresh:
   - in chat core, provider 401/403 triggers `executor.refreshCredentials(...)` retry flow.
3. Validation refresh:
   - `/api/providers/[id]/test` refreshes tokens for refreshable OAuth providers when expired.

### F) Manual/operator transitions
- `/api/providers/[id]` update allows direct status field edits (`testStatus`, `lastError`, `lastErrorAt`) and activation toggles (`isActive`).
- Dashboard provider detail can clear error fields and set active semantics through update calls.

## UI state projection rules
### Provider list view
- Effective status computes unavailable+expired-cooldown as active for display.
- Connected count includes `active` and `success`.
- Error count includes `error`, `expired`, `unavailable` (while still effectively in error branch).

### Provider detail view
- Displays cooldown countdown when `rateLimitedUntil` is in future.
- Chooses badge variant using effective status logic.
- Shows `lastError` detail and allows operational edits.

## Combo-level state behavior
- Combo routing loops through models using `checkFallbackError(...)`.
- Fallback-able failures move to next model; non-fallback errors return immediately.
- Combo state does not persist separate records; it composes underlying account states.

## Side effects and persistence touchpoints
- State writes occur in:
  - `src/sse/services/auth.js` (`markAccountUnavailable`, `clearAccountError`, round-robin counters)
  - `src/app/api/providers/[id]/test/route.js` (validation outcomes + refreshed tokens)
  - `src/sse/services/tokenRefresh.js` wrappers (credential updates)
  - `src/app/api/sync/cloud/route.js` (cloud reconciliation writes newer token/error state)

## Operational debugging checklist
- If account is skipped unexpectedly, inspect:
  - `isActive`
  - `rateLimitedUntil`
  - `testStatus`
  - `lastError`/`errorCode`
- If round-robin feels stuck on one account, inspect:
  - `settings.fallbackStrategy`
  - `settings.stickyRoundRobinLimit`
  - account `lastUsedAt` and `consecutiveUseCount`
- If token churn occurs, inspect:
  - `expiresAt`
  - provider-specific refresh support in executor
  - `/api/providers/[id]/test` refresh result

## Related docs
- @doc/project/project-overview
- @doc/project/api-map
- @doc/project/data-model-map
- Task ID: k8qz45
