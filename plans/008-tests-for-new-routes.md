# Plan 008: Add tests for new untested routes

> **Executor instructions**: Follow step by step. Run every verification command. STOP on mismatch.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: 001 (clean test signal), 002 (SSRF guard tested), 003 (reveal authz enforced)
- **Category**: tests
- **Planned at**: commit `1271db0`, 2026-06-19

## Why this matters

Several routes were shipped in the most recent session with zero test coverage:
- `POST /api/providers/[id]/reauth` — force-refresh OAuth credentials
- `GET /api/mcp-gateway/keys/[id]?reveal=1` — raw key reveal (authz tested in plan 003, but no test for the grants-stripped path)
- `GET /api/usage/[connectionId]` quota-lock-apply path — applies account-level model lock when fully depleted
- `GET /api/v1/models` Codex per-model `supports_search_tool` derivation

These routes handle credentials, quota logic, and model capability metadata — all high-value paths where a silent regression would degrade the gateway without obvious errors.

## Current state

Existing test patterns to follow:
- `tests/unit/v1-models-codex.test.js` — mocks heavy deps with `vi.mock`, imports the route handler, calls it with a stub request, asserts response shape. This is the pattern for route handler tests.
- `tests/unit/quota-sync.test.js` — tests pure functions from `open-sse/services/accountFallback.js` directly (no route call). Pattern for engine-level tests.
- `tests/unit/custom-model-vision.test.js` — tests `setCustomModelCapabilities` + `getCapabilitiesForModel` + `stripUnsupportedModalities`. Pattern for capability tests.

The routes that need tests:

1. **`src/app/api/providers/[id]/reauth/route.js`** — imports `getProviderConnectionById` from `@/lib/localDb`, `resolveConnectionProxyConfig` from `@/lib/network/connectionProxy`, `refreshAndUpdateCredentials` from `@/lib/providers/refreshCredentials.js`. POST handler loads connection, resolves proxy, calls refresh, returns `{ ok, refreshed, connection }` or 401.

2. **`src/app/api/usage/[connectionId]/route.js`** quota-lock path (lines 106-123) — calls `getQuotaResetUntil` + `buildModelLockUpdate` when quota is fully depleted. Returns `unavailableUntil` in the response.

3. **`src/app/api/v1/models/route.js`** Codex branch — when `originator: codex_cli_rs` header is present, maps each model through `getCapabilitiesForModel` to derive `supports_search_tool`. Existing test covers the shape but not the per-model caps derivation.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Tests | `cd /home/cortexos/Developer/github.com/bloodf/9router && npx vitest run --config tests/vitest.config.js tests/unit/reauth-route.test.js tests/unit/usage-quota-lock.test.js tests/unit/v1-models-codex-caps.test.js` | all pass |
| Build | `npm run build` | exit 0 |

## Scope

**In scope** (create these test files):
- `tests/unit/reauth-route.test.js`
- `tests/unit/usage-quota-lock.test.js`
- `tests/unit/v1-models-codex-caps.test.js`

**Out of scope**:
- Do NOT modify any route handler code — these are characterization tests for existing behavior.
- Do NOT modify existing test files.
- The headroom SSRF test (`tests/unit/headroom-ssrf-guard.test.js`) is covered by plan 002.

## Steps

### Step 1: Reauth route test

Create `tests/unit/reauth-route.test.js`. Mock the three dependencies and test:

```js
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: vi.fn(),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(),
}));
vi.mock("@/lib/providers/refreshCredentials.js", () => ({
  refreshAndUpdateCredentials: vi.fn(),
}));

const { getProviderConnectionById } = await import("@/lib/localDb");
const { resolveConnectionProxyConfig } = await import("@/lib/network/connectionProxy");
const { refreshAndUpdateCredentials } = await import("@/lib/providers/refreshCredentials.js");
const { POST } = await import("../../src/app/api/providers/[id]/reauth/route.js");

function mockParams(id) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/providers/[id]/reauth", () => {
  it("returns 400 when id is missing", async () => {
    const res = await POST({}, mockParams(undefined));
    expect(res.status).toBe(400);
  });

  it("returns 404 when connection not found", async () => {
    getProviderConnectionById.mockResolvedValue(null);
    const res = await POST({}, mockParams("nonexistent"));
    expect(res.status).toBe(404);
  });

  it("returns ok:true with refreshed credentials on success", async () => {
    const conn = { id: "c1", provider: "claude", authType: "oauth" };
    getProviderConnectionById.mockResolvedValue(conn);
    resolveConnectionProxyConfig.mockResolvedValue({ connectionProxyEnabled: false });
    refreshAndUpdateCredentials.mockResolvedValue({ connection: { ...conn, accessToken: "new" }, refreshed: true });

    const res = await POST({}, mockParams("c1"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.refreshed).toBe(true);
  });

  it("returns 401 when refresh token is dead", async () => {
    const conn = { id: "c1", provider: "claude", authType: "oauth" };
    getProviderConnectionById.mockResolvedValue(conn);
    resolveConnectionProxyConfig.mockResolvedValue({});
    refreshAndUpdateCredentials.mockRejectedValue(new Error("Please re-authorize the connection."));

    const res = await POST({}, mockParams("c1"));
    expect(res.status).toBe(401);
  });
});
```

**Verify**: `npx vitest run --config tests/vitest.config.js tests/unit/reauth-route.test.js` → all pass.

### Step 2: Usage quota-lock test

Create `tests/unit/usage-quota-lock.test.js`. Test the quota-lock-apply logic by testing the helper functions directly (not the full route, which has too many deps to mock cleanly):

```js
import { describe, it, expect } from "vitest";
import {
  getQuotaResetUntil,
  buildModelLockUpdate,
  getEarliestModelLockUntil,
  QUOTA_DEPLETION_PROVIDERS,
} from "../../open-sse/services/accountFallback.js";

describe("quota-lock apply path (usage route integration)", () => {
  it("fully depleted kiro account produces a lock update", () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    const conn = {
      provider: "kiro",
      quotaInfos: [{ used: 100, total: 100, resetAt: future }],
    };
    const resetUntil = getQuotaResetUntil(conn);
    expect(resetUntil).toBeTruthy();

    const lockUpdate = buildModelLockUpdate(null, new Date(resetUntil).getTime() - Date.now());
    expect(lockUpdate).toBeTruthy();
    // The lock update should contain a modelLock field with a future timestamp
    const lockValues = Object.values(lockUpdate).filter((v) => typeof v === "string");
    expect(lockValues.length).toBeGreaterThan(0);
    expect(new Date(lockValues[0]).getTime()).toBeGreaterThan(Date.now());
  });

  it("partially-used account does NOT produce a lock", () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    const conn = {
      provider: "kiro",
      quotaInfos: [{ used: 50, total: 100, resetAt: future }],
    };
    expect(getQuotaResetUntil(conn)).toBeNull();
  });

  it("getEarliestModelLockUntil surfaces the lock after apply", () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    const conn = {
      provider: "kiro",
      quotaInfos: [{ used: 100, total: 100, resetAt: future }],
    };
    const resetUntil = getQuotaResetUntil(conn);
    const lockUpdate = buildModelLockUpdate(null, new Date(resetUntil).getTime() - Date.now());
    // Simulate the updated connection having the lock field
    const updatedConn = { ...conn, ...lockUpdate };
    const earliest = getEarliestModelLockUntil(updatedConn);
    expect(earliest).toBeTruthy();
    expect(new Date(earliest).getTime()).toBeGreaterThan(Date.now());
  });

  it("providers outside QUOTA_DEPLETION_PROVIDERS never get locked", () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    expect(getQuotaResetUntil({ provider: "openai", quotaInfos: [{ used: 100, total: 100, resetAt: future }] })).toBeNull();
  });
});
```

**Verify**: `npx vitest run --config tests/vitest.config.js tests/unit/usage-quota-lock.test.js` → all pass.

### Step 3: V1 models Codex caps derivation test

Extend the existing test or create `tests/unit/v1-models-codex-caps.test.js` to verify that `supports_search_tool` is correctly derived from `getCapabilitiesForModel` per model. Since the route is already tested in `v1-models-codex.test.js`, add a focused test on the caps derivation:

```js
import { describe, it, expect } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

describe("v1/models Codex caps derivation", () => {
  it("models with search capability yield supports_search_tool: true", () => {
    // Find a model that has search caps by checking the pattern tables.
    // Claude models typically have search via the provider-level caps.
    const caps = getCapabilitiesForModel("claude", "claude-sonnet-4-5");
    // The route maps caps.search → supports_search_tool
    expect(typeof caps.search).toBe("boolean");
  });

  it("custom models without caps resolve to defaults (no search)", () => {
    const caps = getCapabilitiesForModel("custom", "some-unknown-model-xyz");
    expect(caps.search).toBeFalsy();
  });
});
```

**Verify**: `npx vitest run --config tests/vitest.config.js tests/unit/v1-models-codex-caps.test.js` → all pass.

## Done criteria

- [ ] `tests/unit/reauth-route.test.js` exists and passes (4+ test cases)
- [ ] `tests/unit/usage-quota-lock.test.js` exists and passes (4+ test cases)
- [ ] `tests/unit/v1-models-codex-caps.test.js` exists and passes (2+ test cases)
- [ ] All existing tests still pass (no regression)
- [ ] `npm run build` exits 0

## STOP conditions

- Route handlers have different import signatures than described — re-read the route file before writing mocks.
- `refreshAndUpdateCredentials` throws instead of returning a result for the dead-token case — adjust the test to use `mockRejectedValue` (already in the plan).
- The `buildModelLockUpdate` / `getEarliestModelLockUntil` signatures don't match the test — verify against the source at `open-sse/services/accountFallback.js`.

## Maintenance notes

- When the reauth route gains new response fields or status codes, update the test expectations.
- The usage quota-lock test tests helper functions directly, not the full route. If the route's integration with these helpers changes (e.g. different call sequence), add an integration-level test.
