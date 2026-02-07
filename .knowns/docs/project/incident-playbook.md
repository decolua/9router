---
title: Incident Playbook
createdAt: '2026-02-06T08:33:59.024Z'
updatedAt: '2026-02-06T08:34:43.358Z'
description: >-
  Operational runbook for common 9router incidents with triage and recovery
  steps
tags:
  - ops
  - runbook
  - incident
---
# 9router Incident Playbook

## Purpose
Fast triage + recovery guide for common incidents in production/staging 9router deployments.

## Before you start (2-minute triage)
1. Confirm blast radius:
   - Are all requests failing or only specific providers/models?
   - Is dashboard login broken or only upstream chat traffic?
2. Capture quick signals:
   - `GET /api/usage/logs`
   - provider status in dashboard (`/dashboard/providers`)
   - recent config changes (settings/provider edits/sync enable)
3. Classify incident type using scenarios below.

## Scenario 1 - Global request failures (5xx on `/v1/chat/completions`)
### Symptoms
- Most or all client requests fail with 500/502/503.
- Combos also fail across multiple models.

### Quick checks
- Verify API key exists and is valid:
  - `GET /api/keys`
  - test request with known key against `/v1/models`.
- Check if all provider accounts are disabled/unavailable:
  - `GET /api/providers`
  - inspect `isActive`, `testStatus`, `rateLimitedUntil`.
- Inspect usage/request logs:
  - `GET /api/usage/logs` and `GET /api/usage/request-logs`.

### Likely causes
- No active credentials for target provider.
- Widespread upstream outage or quota exhaustion.
- Misconfigured model alias/combo mapping.

### Mitigation
1. Re-enable at least one healthy account per critical provider (`/api/providers/[id]`).
2. Re-test accounts (`POST /api/providers/[id]/test`).
3. Temporarily route traffic to known healthy providers/models (update aliases/combos).
4. If still failing, switch clients to fallback model list from `/api/v1/models`.

### Code touchpoints
- `src/sse/handlers/chat.js`
- `src/sse/services/auth.js`
- `open-sse/handlers/chatCore.js`

## Scenario 2 - Accounts stuck in cooldown/unavailable
### Symptoms
- Provider cards show `unavailable` with frequent fallback.
- Requests cycle through accounts and end at 503.

### Quick checks
- Inspect account state fields:
  - `testStatus`, `rateLimitedUntil`, `lastError`, `errorCode`.
- Verify fallback strategy settings:
  - `GET /api/settings` (`fallbackStrategy`, `stickyRoundRobinLimit`).

### Likely causes
- Upstream rate limit / quota / transient failures triggering cooldown.
- Aggressive traffic on small account pool.

### Mitigation
1. Wait for cooldown expiry or add more accounts for the provider.
2. Lower pressure: adjust routing to other providers or temporary combo order.
3. Validate account manually (`POST /api/providers/[id]/test`) to confirm recovery.
4. If account recovered, clear stale error state via provider update path.

### Code touchpoints
- `open-sse/services/accountFallback.js`
- `src/sse/services/auth.js`
- `src/app/(dashboard)/dashboard/providers/[id]/page.js`

## Scenario 3 - OAuth token expiry / refresh loop
### Symptoms
- Frequent 401/403 from one provider.
- Same account repeatedly fails despite retries.

### Quick checks
- Inspect connection token fields:
  - `expiresAt`, `refreshToken`, provider-specific token fields.
- Run connection test:
  - `POST /api/providers/[id]/test` and check `refreshed` flag.
- Verify provider refresh support path (executor-specific).

### Likely causes
- Invalid/expired refresh token.
- Provider-specific refresh endpoint issue.
- Token update not persisted after refresh.

### Mitigation
1. Re-auth/import account via `/api/oauth/**` flow.
2. Re-test and ensure account transitions back to active.
3. If cloud sync enabled, confirm refreshed credentials are not overwritten by stale cloud state.

### Code touchpoints
- `src/sse/services/tokenRefresh.js`
- `open-sse/executors/*.js`
- `src/app/api/providers/[id]/test/route.js`
- `src/app/api/sync/cloud/route.js`

## Scenario 4 - Dashboard login/auth issues
### Symptoms
- Login fails unexpectedly, or dashboard loops redirect to `/login`.
- API routes work but dashboard access breaks.

### Quick checks
- Verify JWT env and cookie flow:
  - `JWT_SECRET`, `auth_token` cookie present.
- Check login + settings endpoints:
  - `POST /api/auth/login`
  - `GET|PATCH /api/settings`.
- Confirm proxy/middleware behavior:
  - route protection in `src/proxy.js`.

### Likely causes
- Missing/rotated `JWT_SECRET` without coordinated restart.
- Password changed but operator using stale credential.
- Cookie domain/path/security mismatch in deployment edge.

### Mitigation
1. Confirm environment variables and restart service cleanly.
2. Reset password through settings flow if needed.
3. Re-test login in clean browser profile.

### Code touchpoints
- `src/app/api/auth/login/route.js`
- `src/app/api/settings/route.js`
- `src/proxy.js`

## Scenario 5 - Cloud sync inconsistency (local vs cloud drift)
### Symptoms
- Provider states/tokens appear to revert.
- Alias/key changes disappear or mismatch across instances.

### Quick checks
- Inspect cloud settings:
  - `GET /api/settings` -> `cloudEnabled`.
- Trigger explicit sync and observe response:
  - `POST /api/sync/cloud` with `action: sync`.
- Check last-updated behavior on provider records (`updatedAt`).

### Likely causes
- Newer/older record precedence during reconciliation.
- Partial sync success with stale local cache.
- Connectivity issues to cloud backend.

### Mitigation
1. Run manual sync cycle and verify changes.
2. If needed, disable cloud temporarily (`action: disable`) to stabilize local state.
3. Re-enable cloud after verifying local records and API key state.

### Code touchpoints
- `src/app/api/sync/cloud/route.js`
- `src/shared/services/cloudSyncScheduler.js`
- `src/shared/services/initializeCloudSync.js`

## Scenario 6 - Model alias or combo misrouting
### Symptoms
- Requests hit unexpected provider/model.
- Combo does not fallback as intended.

### Quick checks
- Validate alias map:
  - `GET /api/models/alias`
- Validate combo definitions:
  - `GET /api/combos`
- Confirm model visibility:
  - `GET /api/v1/models`

### Likely causes
- Alias collisions or stale alias mapping.
- Combo points to retired/nonexistent provider model.
- Legacy alias path updates inconsistent with canonical alias API.

### Mitigation
1. Normalize alias entries through `/api/models/alias`.
2. Update combo model order to healthy models.
3. Re-run smoke request per critical alias/combo.

### Code touchpoints
- `src/sse/services/model.js`
- `src/app/api/models/alias/route.js`
- `src/app/api/combos/**`

## Scenario 7 - Usage/log visibility degraded
### Symptoms
- Usage dashboard looks empty/inaccurate.
- Request logs missing.

### Quick checks
- Confirm files and data path permissions:
  - user data directory containing `usage.json` and `log.txt`.
- Check endpoints:
  - `GET /api/usage/history`
  - `GET /api/usage/logs`
- Verify pricing data if cost is zero unexpectedly:
  - `GET /api/pricing`

### Likely causes
- File permission/path issue after deployment.
- Running in environment without expected filesystem behavior.
- Token fields missing from upstream response reduce usage extraction fidelity.

### Mitigation
1. Fix data directory mount/permission.
2. Validate write access and restart service.
3. Re-test with a non-streaming request to confirm usage entry append.

### Code touchpoints
- `src/lib/usageDb.js`
- `src/app/api/usage/**`
- `src/lib/localDb.js` (pricing)

## Runbook commands (HTTP checklist)
- Health-ish probes:
  - `GET /api/v1/models`
  - `GET /api/providers`
  - `GET /api/settings`
- Recovery actions:
  - `POST /api/providers/[id]/test`
  - `POST /api/sync/cloud` (`enable` / `sync` / `disable`)
  - `PATCH /api/settings` (routing strategy adjustments)
- Evidence capture:
  - `GET /api/usage/logs`
  - `GET /api/usage/request-logs`

## Escalation guidance
Escalate to code-level debugging when:
- two or more providers fail after account re-auth and validation,
- cloud sync repeatedly overwrites fresh credentials,
- token refresh appears successful but requests still 401/403,
- incidents recur within 15 minutes after mitigation.

## Related docs
- @doc/project/project-overview
- @doc/project/api-map
- @doc/project/data-model-map
- @doc/project/state-machine-map
- Task ID: c92mx6
