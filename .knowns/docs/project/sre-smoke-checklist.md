---
title: SRE Smoke Checklist
createdAt: '2026-02-06T08:41:26.067Z'
updatedAt: '2026-02-06T08:46:42.286Z'
description: Pre-deploy and post-deploy operational smoke checks for 9router
tags:
  - sre
  - ops
  - runbook
  - checklist
---
# 9router SRE Smoke Checklist

## Purpose
Fast checks before and after deploy to catch high-impact failures early.

## How to use
- Run pre-deploy checks in staging (or canary) before promoting.
- Run post-deploy checks immediately on production.
- Stop rollout if any P0/P1 gate fails.

## Variables
Set these once for all commands:
- `BASE_URL` (example: `http://localhost:3000` or production domain)
- `API_KEY` (valid key from `/api/keys`)
- `MODEL` (known healthy model, example: `cc/claude-sonnet-4-5-20250929`)

## Pre-deploy checklist (must pass)
### 1) Service reachability
- Probe:
  - `GET $BASE_URL/api/v1/models`
- Pass criteria:
  - HTTP 200
  - JSON contains `data` array.
- Severity:
  - P0 (block deploy)

### 2) Auth surface check (dashboard)
- Probe:
  - `POST $BASE_URL/api/auth/login` with known credential.
- Pass criteria:
  - HTTP 200
  - `auth_token` cookie set.
- Severity:
  - P1 (block deploy if dashboard is in scope)

### 3) Provider inventory sanity
- Probe:
  - `GET $BASE_URL/api/providers`
- Pass criteria:
  - At least one connection exists for critical providers.
  - No mass `isActive=false` accidental state.
- Severity:
  - P0 if no critical provider available

### 4) Request path auth/key check
- Probe:
  - `GET $BASE_URL/api/v1/models` with `Authorization: Bearer $API_KEY`.
- Pass criteria:
  - HTTP 200
  - Model list returns expected providers.
- Severity:
  - P0

### 5) Minimal chat probe (non-stream)
- Probe:
  - `POST $BASE_URL/v1/chat/completions` with small request (`max_tokens` low, stream false).
- Pass criteria:
  - HTTP 200
  - JSON has `choices[0]`.
- Severity:
  - P0

### 6) Usage pipeline sanity
- Probe:
  - After chat probe, call `GET $BASE_URL/api/usage/history`.
- Pass criteria:
  - Request count increases or latest record timestamp updates.
- Severity:
  - P1

### 7) Optional cloud sync gate (if enabled)
- Probe:
  - `GET $BASE_URL/api/settings` then `POST $BASE_URL/api/sync/cloud` with `{"action":"sync"}` if `cloudEnabled=true`.
- Pass criteria:
  - Sync returns success / no 5xx.
- Severity:
  - P1

## Post-deploy checklist (first 10 minutes)
### 1) Repeat health probes
- Re-run:
  - `/api/v1/models`
  - one minimal `/v1/chat/completions`
- Pass criteria:
  - no regression vs pre-deploy.

### 2) Error budget quick scan
- Probe:
  - `GET $BASE_URL/api/usage/logs`
- Pass criteria:
  - No sustained spike of `FAILED 5xx/4xx` for critical model/provider.

### 3) Account state scan
- Probe:
  - `GET $BASE_URL/api/providers`
- Pass criteria:
  - No broad transition to `unavailable/error` across all accounts.
  - `rateLimitedUntil` not simultaneously active on all critical accounts.

### 4) Routing strategy confirmation
- Probe:
  - `GET $BASE_URL/api/settings`
- Pass criteria:
  - `fallbackStrategy` and `stickyRoundRobinLimit` match intended rollout config.

### 5) Critical alias/combo verification
- Probe:
  - `GET $BASE_URL/api/models/alias`
  - `GET $BASE_URL/api/combos`
  - 1 smoke request per critical alias/combo.
- Pass criteria:
  - Alias resolves to expected provider/model.
  - Combo fallback behavior still works.

## Copy-paste HTTP probes (curl)
### Get models
```bash
curl -sS "$BASE_URL/api/v1/models"
```

### Login check

```bash
curl -i -sS -X POST "$BASE_URL/api/auth/login" 
  -H "Content-Type: application/json" 
  -d '{"password":"<PASSWORD>"}'
```
### Provider list
```bash
curl -sS "$BASE_URL/api/providers"
```

### Minimal chat
```bash
curl -sS -X POST "$BASE_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d "{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"ping\"}],\"stream\":false,\"max_tokens\":32}"
```

### Usage quick read
```bash
curl -sS "$BASE_URL/api/usage/history"
```

### Cloud sync (conditional)

```bash
curl -sS -X POST "$BASE_URL/api/sync/cloud" 
  -H "Content-Type: application/json" 
  -d '{"action":"sync"}'
```
## Rollback triggers
Trigger rollback if any occurs for >3 minutes after deploy:
- P0 gate failure (`/api/v1/models` down or chat probe fails consistently).
- No available healthy account for critical provider.
- Auth/login broken for operator dashboard when release includes auth/UI.
- Cloud sync introduces repeated credential/state overwrite regressions.

## Escalation triggers
Escalate to code-level incident flow when:
- Same failure recurs after one clean restart and one provider re-test.
- 401/403 refresh loop persists across re-auth.
- Combo/alias routing diverges from configured mappings.

## Related docs
- @doc/project/project-overview
- @doc/project/api-map
- @doc/project/state-machine-map
- @doc/project/incident-playbook
- Task ID: imh1xk
