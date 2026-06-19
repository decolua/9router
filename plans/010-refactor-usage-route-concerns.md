# Plan 010: Refactor `usage/[connectionId]/route.js` — separate concerns

> **Executor instructions**: Follow step by step. Run every verification command. STOP on mismatch. This is the highest-risk plan — proceed carefully.

## Status

- **Priority**: P3
- **Effort**: L
- **Risk**: MED
- **Depends on**: 001 (clean tests), 008 (route tests as safety net)
- **Category**: tech-debt
- **Planned at**: commit `1271db0`, 2026-06-19 (target file modified in working tree: `M src/app/api/usage/[connectionId]/route.js`)

## Why this matters

`src/app/api/usage/[connectionId]/route.js` is a 130-line GET handler that mixes five concerns: (1) auth-type validation, (2) proxy resolution, (3) credential refresh, (4) quota fetch + persist, (5) account-lock apply. The `refreshCredentials.js` extraction already moved one concern out; this plan extracts the remaining concerns into focused helpers so the route is a thin orchestration layer. This makes each concern independently testable and reduces the risk of cross-cutting regressions.

**This plan should be executed AFTER plans 001 and 008** — the new route tests from plan 008 serve as the characterization safety net. Without those tests, this refactor is unsafe.

## Current state

`src/app/api/usage/[connectionId]/route.js` (129 lines) — the GET handler:

```
Line 24:   export async function GET(request, { params }) {
Line 27:     const { connectionId } = await params;
Line 31:     connection = await getProviderConnectionById(connectionId);
Line 39-47:  Auth-type validation (isOAuth, isApikeyEligible)
Line 50-57:  Proxy resolution (resolveConnectionProxyConfig → proxyOptions)
Line 59-70:  Credential refresh (refreshAndUpdateCredentials, conditional on isOAuth)
Line 73:     usage = await getUsageForProvider(connection, proxyOptions)
Line 76-85:  Auth-expired retry (force-refresh + retry once)
Line 91-104: Quota persist (updateProviderConnection with quotaInfos)
Line 106-123: Quota-lock apply (getQuotaResetUntil → buildModelLockUpdate)
Line 125-128: Return Response.json(usage + unavailableUntil)
```

Five distinct concerns in one function. The handler also catches errors at line 128 and returns a generic 500.

Already extracted: `refreshAndUpdateCredentials` lives in `src/lib/providers/refreshCredentials.js`.

Not yet extracted: auth-type validation, proxy resolution, quota persist, quota-lock apply.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Build | `npm run build` | exit 0 |
| Existing tests | `npx vitest run --config tests/vitest.config.js tests/unit/usage-quota-lock.test.js` | all pass |
| Regression | `node tests/__baseline__/verify-no-regression.mjs tests/__baseline__/current.json` | no regression |

## Scope

**In scope**:
- `src/app/api/usage/[connectionId]/route.js` — refactor the GET handler
- `src/lib/usage/quotaPersist.js` (create — quota persist + lock apply logic)
- `src/lib/usage/authCheck.js` (create — auth-type validation)

**Out of scope**:
- Do NOT modify `src/lib/providers/refreshCredentials.js` — already extracted.
- Do NOT modify `open-sse/services/accountFallback.js` — engine code is stable.
- Do NOT change the response shape — clients depend on `{ ...usage, unavailableUntil }`.
- Do NOT modify any test file (plan 008 tests serve as the safety net).

## Steps

### Step 1: Extract auth-type validation

Create `src/lib/usage/authCheck.js`:

```js
import { USAGE_APIKEY_PROVIDERS } from "@/shared/constants/providers";

/**
 * Determine whether a connection is eligible for usage tracking.
 * OAuth connections are always eligible; apikey connections only for
 * whitelisted providers. Both "apikey" and "api_key" spellings are accepted.
 *
 * @returns {{ isOAuth: boolean, isEligible: boolean }}
 */
export function checkUsageEligibility(connection) {
  if (!connection) return { isOAuth: false, isEligible: false };
  const isOAuth = connection.authType === "oauth";
  const isApikeyAuth =
    connection.authType === "apikey" || connection.authType === "api_key";
  const isEligible = isOAuth || (isApikeyAuth && USAGE_APIKEY_PROVIDERS.includes(connection.provider));
  return { isOAuth, isEligible };
}
```

**Verify**: File exists, exports `checkUsageEligibility`.

### Step 2: Extract quota persist + lock apply

Create `src/lib/usage/quotaPersist.js`:

```js
import { updateProviderConnection } from "@/lib/localDb";
import {
  getQuotaResetUntil,
  buildModelLockUpdate,
  getEarliestModelLockUntil,
} from "open-sse/services/accountFallback.js";

/**
 * Persist the latest quota snapshot onto the connection record.
 * Only overwrites quotaInfos when buckets are present — keeps the last good
 * snapshot when the provider transiently returns an auth/empty response.
 */
export async function persistQuotaSnapshot(connection, quotaInfos) {
  if (!Array.isArray(quotaInfos) || quotaInfos.length === 0) return connection;
  try {
    await updateProviderConnection(connection.id, { quotaInfos, updatedAt: new Date().toISOString() });
    return { ...connection, quotaInfos };
  } catch (e) {
    console.warn(`[Usage] ${connection.provider}: failed to persist quota: ${e.message}`);
    return connection;
  }
}

/**
 * Apply an account-level model lock when the account is fully depleted
 * with a future resetAt. Returns the updated connection (for response shaping).
 */
export async function applyQuotaLockIfNeeded(connection) {
  const connectionWithQuota = { ...connection, quotaInfos: connection.quotaInfos || [] };
  const resetUntil = getQuotaResetUntil(connectionWithQuota);
  if (!resetUntil) return connection;

  const cooldownMs = new Date(resetUntil).getTime() - Date.now();
  if (cooldownMs <= 0) return connection;

  try {
    await updateProviderConnection(connection.id, buildModelLockUpdate(null, cooldownMs));
    return { ...connection, quotaInfos: connectionWithQuota.quotaInfos };
  } catch (e) {
    console.warn(`[Usage] ${connection.provider}: failed to apply quota lock: ${e.message}`);
    return connection;
  }
}

/**
 * Compute the earliest model-lock-until timestamp for the response.
 */
export function getUnavailableUntil(connection) {
  return getEarliestModelLockUntil(connection) || null;
}
```

**Verify**: File exists, exports `persistQuotaSnapshot`, `applyQuotaLockIfNeeded`, `getUnavailableUntil`.

### Step 3: Refactor the route handler

Rewrite `src/app/api/usage/[connectionId]/route.js` GET handler to use the extracted helpers. The route becomes a thin orchestration layer:

```js
import "open-sse/index.js";
import { getProviderConnectionById } from "@/lib/localDb";
import { refreshAndUpdateCredentials } from "@/lib/providers/refreshCredentials.js";
import { getUsageForProvider } from "open-sse/services/usage.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { checkUsageEligibility } from "@/lib/usage/authCheck.js";
import { persistQuotaSnapshot, applyQuotaLockIfNeeded, getUnavailableUntil } from "@/lib/usage/quotaPersist.js";

const AUTH_EXPIRED_PATTERNS = ["expired", "authentication", "unauthorized", "401", "re-authorize"];
function isAuthExpiredMessage(usage) {
  if (!usage?.message) return false;
  const msg = usage.message.toLowerCase();
  return AUTH_EXPIRED_PATTERNS.some((p) => msg.includes(p));
}

export async function GET(request, { params }) {
  let connection;
  try {
    const { connectionId } = await params;
    connection = await getProviderConnectionById(connectionId);
    if (!connection) return Response.json({ error: "Connection not found" }, { status: 404 });

    const { isOAuth, isEligible } = checkUsageEligibility(connection);
    if (!isEligible) return Response.json({ message: "Usage not available for this connection" });

    // Resolve proxy config
    const proxyConfig = await resolveConnectionProxyConfig(connection.providerSpecificData);
    const proxyOptions = {
      connectionProxyEnabled: proxyConfig.connectionProxyEnabled === true,
      connectionProxyUrl: proxyConfig.connectionProxyUrl || "",
      connectionNoProxy: proxyConfig.connectionNoProxy || "",
      vercelRelayUrl: proxyConfig.vercelRelayUrl || "",
      strictProxy: false,
    };

    // Refresh credentials (OAuth only)
    if (isOAuth) {
      try {
        const { connection: updated } = await refreshAndUpdateCredentials(connection, false, proxyOptions);
        connection = updated;
      } catch (e) { /* non-fatal — try with existing creds */ }
    }

    // Fetch usage
    let usage = await getUsageForProvider(connection, proxyOptions);

    // Auth-expired retry (OAuth only)
    if (isOAuth && isAuthExpiredMessage(usage) && connection.refreshToken) {
      try {
        const { connection: updated } = await refreshAndUpdateCredentials(connection, true, proxyOptions);
        connection = updated;
        usage = await getUsageForProvider(connection, proxyOptions);
      } catch (e) { /* return the auth-expired usage as-is */ }
    }

    // Persist quota snapshot
    connection = await persistQuotaSnapshot(connection, usage?.quotas);

    // Apply account-level lock if depleted
    connection = await applyQuotaLockIfNeeded(connection);

    return Response.json({ ...usage, unavailableUntil: getUnavailableUntil(connection) });
  } catch (error) {
    console.log("Error fetching usage:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
```

**Verify**: `npm run build` exits 0. Read the route — it imports from `@/lib/usage/authCheck.js` and `@/lib/usage/quotaPersist.js`, and the handler body matches the structure above.

### Step 4: Run existing tests to verify no regression

```bash
cd /home/cortexos/Developer/github.com/bloodf/9router
npx vitest run --config tests/vitest.config.js tests/unit/usage-quota-lock.test.js
node tests/__baseline__/verify-no-regression.mjs tests/__baseline__/current.json
```

**Verify**: All tests pass, no regression.

## Done criteria

- [ ] `src/lib/usage/authCheck.js` exists and exports `checkUsageEligibility`
- [ ] `src/lib/usage/quotaPersist.js` exists and exports `persistQuotaSnapshot`, `applyQuotaLockIfNeeded`, `getUnavailableUntil`
- [ ] Route handler is ≤50 lines (down from 130)
- [ ] Response shape unchanged: `{ ...usage, unavailableUntil }`
- [ ] All existing tests pass
- [ ] `npm run build` exits 0
- [ ] Regression verifier reports no regression

## STOP conditions

- The route file doesn't match the current-state excerpts (it has drifted since the plan was written — it was modified in the working tree).
- `getUsageForProvider` returns a different shape than `{ quotas: [...], ... }` — verify the field name used for quota buckets before wiring `persistQuotaSnapshot`.
- Extracting the proxy-options construction changes the proxy behavior — compare the old and new proxyOptions objects byte-for-byte.
- Any existing test fails after the refactor — STOP and investigate; do not modify tests to make them pass.

## Maintenance notes

- The extracted `quotaPersist.js` and `authCheck.js` modules can now be unit-tested independently (plan 008 tests the helpers directly; these modules could get their own dedicated test file later).
- If a new quota-depletion provider is added, update `QUOTA_DEPLETION_PROVIDERS` in `accountFallback.js` — `quotaPersist.js` imports it transitively.
- The proxy-options construction is duplicated between this route and `reauth/route.js` — a future plan could extract a `buildProxyOptions(connection)` helper.
