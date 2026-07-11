# Network Security, Proxy Consistency, and WARP Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade vulnerable proxy dependencies, unify HTTP/SOCKS dispatcher behavior, reconcile sensitive-provider strict routing, expose sanitized WARP health, deploy safely, then investigate Antigravity failures independently.

**Architecture:** Extract protocol selection and SOCKS tunnel construction into one network Module consumed by cached runtime fetches and one-shot proxy tests. Retain hybrid global failover while enforcing and reconciling `strictProxy` for `antigravity`, `xai`, and `github`; expose WARP state through a bounded, authenticated, secret-free health Interface.

**Tech Stack:** Next.js, Node.js ESM, Undici, `socks`, Vitest, pnpm, SQLite repositories, PM2, rootless wireproxy/WARP.

## Global Constraints

- Install and lock `undici >=7.28.0` and `http-proxy-middleware >=3.0.7`.
- Global outbound mode remains hybrid `failover`.
- `antigravity`, `xai`, and `github` always fail closed through `strictProxy=true`.
- SOCKS destinations use proxy-side hostname resolution for every supported SOCKS scheme.
- Never expose or mutate credentials, tokens, cookies, proxy URLs, or raw Cloudflare trace data.
- Never use WARP/MITM as an IAM, `projectId`, entitlement, or SKU bypass.
- Leave the unrelated dirty `.gitignore` unstaged.
- Use RED -> GREEN -> REFACTOR for every behavior change.

---

## File Structure

- Create `src/lib/network/proxyDispatcher.js`: normalization, scheme validation, SOCKS connector, Undici dispatcher factory, disposal.
- Modify `open-sse/utils/proxyFetch.js`: consume shared factory while retaining cache and strict/direct-fallback policy.
- Modify `src/lib/network/proxyTest.js`: consume one-shot shared dispatcher and dispose it.
- Modify `package.json`, `pnpm-lock.yaml`: security upgrades.
- Create `src/lib/network/strictProxyReconciliation.js`: pure planning plus idempotent repository reconciliation.
- Modify `src/shared/services/initializeApp.js`: invoke reconciliation during initialization.
- Create `src/lib/network/warpHealth.js`: sanitized health DTO and bounded trace probe.
- Create `src/app/api/settings/warp-health/route.js`: authenticated-by-dashboard-guard health endpoint.
- Create/modify focused Vitest files under `tests/unit/` for each Interface.
- Antigravity source files remain untouched until a failing test identifies an exact repair seam.

### Task 1: Upgrade Undici and lock the security floor

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `tests/unit/proxy-dependency-versions.test.js`

**Interfaces:**
- Produces: installed `undici` version satisfying `>=7.28.0` for all later proxy tasks.

- [ ] **Step 1: Write the failing dependency-floor test**

```js
import { describe, expect, it } from "vitest";
import undiciPackage from "undici/package.json" with { type: "json" };

const parse = (value) => value.split(".").map(Number);
const atLeast = (actual, minimum) => {
  const a = parse(actual);
  const b = parse(minimum);
  return a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] >= b[2])));
};

describe("proxy dependency security floors", () => {
  it("uses undici 7.28.0 or newer", () => {
    expect(atLeast(undiciPackage.version, "7.28.0")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm vitest run --config tests/vitest.config.js tests/unit/proxy-dependency-versions.test.js`
Expected: FAIL because installed Undici is below `7.28.0`.

- [ ] **Step 3: Upgrade only Undici**

Run: `pnpm add undici@^7.28.0`
Expected: `package.json` and lockfile resolve Undici at `7.28.0` or newer without unrelated dependency churn.

- [ ] **Step 4: Run dependency and existing proxy regressions**

Run:
```bash
pnpm vitest run --config tests/vitest.config.js \
  tests/unit/proxy-dependency-versions.test.js \
  tests/unit/proxy-fetch-dispatcher.test.js \
  tests/unit/proxy-fetch-socks-connector.test.js \
  tests/unit/proxy-fetch-dispatcher-lifecycle.test.js
```
Expected: PASS.

- [ ] **Step 5: Run audit and inspect exact resolved version**

Run: `pnpm why undici && pnpm audit --prod --audit-level high`
Expected: resolved direct Undici is `>=7.28.0`; the prior Undici SOCKS5 TLS advisory is absent.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml tests/unit/proxy-dependency-versions.test.js
git commit -m "chore(proxy): upgrade undici past SOCKS TLS advisory"
```

### Task 2: Extract the shared proxy dispatcher Module

**Files:**
- Create: `src/lib/network/proxyDispatcher.js`
- Modify: `open-sse/utils/proxyFetch.js:199-343`
- Modify: `tests/unit/proxy-fetch-dispatcher.test.js`
- Modify: `tests/unit/proxy-fetch-socks-connector.test.js`
- Modify: `tests/unit/proxy-fetch-dispatcher-lifecycle.test.js`
- Create: `tests/unit/proxy-dispatcher.test.js`

**Interfaces:**
- Produces: `normalizeProxyUrl(string): string|null`, `isSocksProxyUrl(string): boolean`, `createSocksConnector(string): Function`, `createProxyDispatcher(string): Promise<Dispatcher>`, `disposeProxyDispatcher(Dispatcher): void`.
- Consumes: Undici `Agent`/`ProxyAgent`, `SocksClient.createConnection`, Node `tls.connect`.

- [ ] **Step 1: Write RED tests for the shared Interface**

Test exact behavior:
```js
expect(normalizeProxyUrl("127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
expect(isSocksProxyUrl("socks5h://127.0.0.1:40000")).toBe(true);
await expect(createProxyDispatcher("ftp://example.com")).rejects.toThrow("Unsupported proxy protocol");
expect(ProxyAgent).toHaveBeenCalledWith({ uri: "https://127.0.0.1:8443" });
expect(Agent).toHaveBeenCalledWith({ connect: expect.any(Function) });
```
Also assert that all four SOCKS schemes pass the destination hostname unchanged to `SocksClient.createConnection`, and HTTPS wrapping calls TLS with `servername`, `rejectUnauthorized: true`, and `ALPNProtocols: ["http/1.1"]`.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm vitest run --config tests/vitest.config.js tests/unit/proxy-dispatcher.test.js`
Expected: FAIL because `src/lib/network/proxyDispatcher.js` does not exist.

- [ ] **Step 3: Implement the focused Module**

Implement exports with this contract:
```js
export const SOCKS_PROXY_SCHEMES = new Set(["socks5:", "socks5h:", "socks4:", "socks4a:"]);
export function normalizeProxyUrl(proxyUrl) { /* trim; host:port -> http://; reject unsupported */ }
export function isSocksProxyUrl(proxyUrl) { /* URL protocol membership */ }
export function createSocksConnector(proxyUrl) { /* SocksClient tunnel; hostname unchanged; TLS verify */ }
export async function createProxyDispatcher(proxyUrl) { /* ProxyAgent or Agent */ }
export function disposeProxyDispatcher(dispatcher) { /* destroy, else close, catch rejection */ }
```
For TLS use:
```js
tlsConnect({ socket, servername: options.servername || hostname, rejectUnauthorized: true, ALPNProtocols: ["http/1.1"] });
```

- [ ] **Step 4: Replace duplicate runtime code**

In `open-sse/utils/proxyFetch.js`, import the shared functions, delete local scheme/normalization/connector/disposal definitions, and change cache creation to:
```js
proxyDispatchers.set(normalized, await createProxyDispatcher(normalized));
```
Keep cache eviction, reset, and strict fallback logic local to `proxyFetch.js`.

- [ ] **Step 5: Update mocks/imports in existing tests**

Mock `@/lib/network/proxyDispatcher.js` only where cache behavior is under test; test protocol selection and connector behavior directly through `proxy-dispatcher.test.js`. Do not duplicate connector assertions in runtime tests.

- [ ] **Step 6: Run focused tests and syntax checks**

Run:
```bash
pnpm vitest run --config tests/vitest.config.js \
  tests/unit/proxy-dispatcher.test.js \
  tests/unit/proxy-fetch-dispatcher.test.js \
  tests/unit/proxy-fetch-socks-connector.test.js \
  tests/unit/proxy-fetch-dispatcher-lifecycle.test.js
node --check src/lib/network/proxyDispatcher.js
node --check open-sse/utils/proxyFetch.js
```
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/network/proxyDispatcher.js open-sse/utils/proxyFetch.js tests/unit/proxy-*.test.js
git commit -m "refactor(proxy): share protocol-aware dispatcher module"
```

### Task 3: Align dashboard proxy tests with runtime SOCKS support

**Files:**
- Modify: `src/lib/network/proxyTest.js`
- Modify: `tests/unit/proxy-test.test.js`

**Interfaces:**
- Consumes: `createProxyDispatcher(proxyUrl)` and `disposeProxyDispatcher(dispatcher)`.
- Preserves: `testProxyUrl({ proxyUrl, testUrl, timeoutMs }): Promise<{ok,status,...}>`.

- [ ] **Step 1: Extend proxy-test tests to RED**

Mock the shared Module and assert:
```js
expect(createProxyDispatcher).toHaveBeenCalledWith("socks5h://127.0.0.1:40000");
expect(undiciFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ dispatcher }));
expect(disposeProxyDispatcher).toHaveBeenCalledWith(dispatcher);
```
Add invalid-protocol coverage expecting `{ ok:false, status:400, error: expect.stringContaining("Unsupported proxy protocol") }` and timeout coverage verifying disposal exactly once.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run --config tests/vitest.config.js tests/unit/proxy-test.test.js`
Expected: FAIL because `proxyTest.js` constructs `ProxyAgent` directly.

- [ ] **Step 3: Replace direct ProxyAgent construction**

Use:
```js
dispatcher = await createProxyDispatcher(normalizedProxyUrl);
```
and in the outer `finally`:
```js
disposeProxyDispatcher(dispatcher);
```
Convert factory validation errors into the existing sanitized HTTP 400 result.

- [ ] **Step 4: Run focused and route-adjacent suites**

Run:
```bash
pnpm vitest run --config tests/vitest.config.js \
  tests/unit/proxy-test.test.js \
  tests/unit/proxy-dispatcher.test.js \
  tests/unit/proxy-display.test.js
node --check src/lib/network/proxyTest.js
```
Expected: PASS.

- [ ] **Step 5: Run a real one-shot WARP proxy test**

Run a local Node harness calling `testProxyUrl({proxyUrl:"socks5h://127.0.0.1:40000", testUrl:"https://www.cloudflare.com/cdn-cgi/trace"})` without printing proxy credentials.
Expected: HTTP success; no `Invalid URL protocol` error.

- [ ] **Step 6: Commit**

```bash
git add src/lib/network/proxyTest.js tests/unit/proxy-test.test.js
git commit -m "fix(proxy): support SOCKS in dashboard proxy tests"
```

### Task 4: Reconcile strictProxy storage drift at startup

**Files:**
- Create: `src/lib/network/strictProxyReconciliation.js`
- Modify: `src/shared/services/initializeApp.js:1-65`
- Create: `tests/unit/strict-proxy-reconciliation.test.js`

**Interfaces:**
- Consumes: `getProviderConnections()`, `updateProviderConnection(id,data)`, `shouldForceStrictProxy(provider)`.
- Produces: `reconcileStrictProxyConnections({listConnections, updateConnection, log}): Promise<{checked,repaired}>`.

- [ ] **Step 1: Write RED tests for pure dependency-injected reconciliation**

Cover sensitive false/missing flags, compliant rows, non-sensitive rows, credential preservation, idempotence, and count-only logging. Assert updates are exactly:
```js
{
  strictProxy: true,
  providerSpecificData: { ...existing.providerSpecificData, strictProxy: true }
}
```
and never include access tokens/cookies/API keys copied into logs.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run --config tests/vitest.config.js tests/unit/strict-proxy-reconciliation.test.js`
Expected: FAIL because the Module does not exist.

- [ ] **Step 3: Implement reconciliation**

Implement one list pass, update only drifted sensitive rows, preserve nested metadata immutably, return counts, and log only:
```js
log.info({ checked, repaired }, "[StrictProxy] reconciliation completed");
```
Use repository update calls so existing DB serialization/atomic write behavior is preserved.

- [ ] **Step 4: Wire initialization**

Import and await reconciliation immediately after `cleanupProviderConnections()` and before provider traffic workers start. Keep runtime `resolveStrictProxyFlag` enforcement unchanged as defense in depth.

- [ ] **Step 5: Run policy/repository/init tests**

Run:
```bash
pnpm vitest run --config tests/vitest.config.js \
  tests/unit/strict-proxy-policy.test.js \
  tests/unit/strict-proxy-reconciliation.test.js
node --check src/lib/network/strictProxyReconciliation.js
node --check src/shared/services/initializeApp.js
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/network/strictProxyReconciliation.js src/shared/services/initializeApp.js tests/unit/strict-proxy-reconciliation.test.js
git commit -m "fix(proxy): reconcile sensitive strictProxy storage at startup"
```

### Task 5: Add sanitized WARP health service and API

**Files:**
- Create: `src/lib/network/warpHealth.js`
- Create: `src/app/api/settings/warp-health/route.js`
- Create: `tests/unit/warp-health.test.js`
- Create: `tests/unit/warp-health-route.test.js`

**Interfaces:**
- Produces: `checkWarpHealth({settings,listConnections,testProxy,now}): Promise<WarpHealthDto>`.
- DTO: `{configured:boolean, reachable:boolean, warp:boolean, strictConnections:number, checkedAt:string, status:"not_configured"|"unreachable"|"warp_off"|"healthy"}`.
- Consumes: settings, connection list, `testProxyUrl`, strict-provider policy.

- [ ] **Step 1: Write RED service tests**

Cover all four statuses. Mock trace responses so only the body line `warp=on` sets `warp:true`. Recursively assert output keys never contain `url`, `proxy`, `token`, `cookie`, `password`, `email`, or raw trace content.

- [ ] **Step 2: Run service test and verify RED**

Run: `pnpm vitest run --config tests/vitest.config.js tests/unit/warp-health.test.js`
Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement bounded sanitized service**

Use configured settings only to call the injected probe; never copy them into the DTO. Count a sensitive connection only when both top-level and nested flags are true. Use a fixed trace target and timeout no greater than 5 seconds. Return status rather than throwing for probe failures.

- [ ] **Step 4: Write RED route tests**

Mock `getSettings`, `getProviderConnections`, and service. Assert GET returns `Cache-Control: no-store` and exactly the DTO fields. Confirm the path is covered by the existing dashboard guard rather than introducing a second auth mechanism.

- [ ] **Step 5: Implement route**

Create a force-dynamic GET route that obtains data internally, invokes the service, and returns the sanitized DTO. On internal failure return a sanitized 500 `{status:"error"}` without `error.message` leakage.

- [ ] **Step 6: Run tests and syntax checks**

Run:
```bash
pnpm vitest run --config tests/vitest.config.js tests/unit/warp-health.test.js tests/unit/warp-health-route.test.js
node --check src/lib/network/warpHealth.js
node --check src/app/api/settings/warp-health/route.js
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/network/warpHealth.js src/app/api/settings/warp-health/route.js tests/unit/warp-health*.test.js
git commit -m "feat(proxy): expose sanitized WARP health status"
```

### Task 6: Upgrade http-proxy-middleware and run combined release gates

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `tests/unit/proxy-dependency-versions.test.js`

**Interfaces:**
- Produces: installed `http-proxy-middleware >=3.0.7`.

- [ ] **Step 1: Extend dependency-floor test to RED**

Import `http-proxy-middleware/package.json` and assert `atLeast(version,"3.0.7")`.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run --config tests/vitest.config.js tests/unit/proxy-dependency-versions.test.js`
Expected: FAIL with installed version below `3.0.7`.

- [ ] **Step 3: Upgrade dependency**

Run: `pnpm add http-proxy-middleware@^3.0.7`
Expected: package and lockfile update without unrelated major upgrades.

- [ ] **Step 4: Run all targeted suites**

Run:
```bash
pnpm vitest run --config tests/vitest.config.js \
  tests/unit/proxy-dependency-versions.test.js \
  tests/unit/proxy-dispatcher.test.js \
  tests/unit/proxy-fetch-dispatcher.test.js \
  tests/unit/proxy-fetch-socks-connector.test.js \
  tests/unit/proxy-fetch-dispatcher-lifecycle.test.js \
  tests/unit/proxy-test.test.js \
  tests/unit/proxy-display.test.js \
  tests/unit/strict-proxy-policy.test.js \
  tests/unit/strict-proxy-reconciliation.test.js \
  tests/unit/warp-health.test.js \
  tests/unit/warp-health-route.test.js
```
Expected: all PASS.

- [ ] **Step 5: Run audit, diff, build**

Run:
```bash
pnpm audit --prod --audit-level high
git diff --check
pnpm build
```
Expected: targeted Undici and http-proxy-middleware advisories absent; diff clean; build exit 0. Record unrelated remaining advisories separately.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml tests/unit/proxy-dependency-versions.test.js
git commit -m "chore(proxy): patch proxy middleware advisory"
```

### Task 7: Push, deploy, and verify network hardening live

**Files:**
- No source changes expected.

**Interfaces:**
- Consumes: standard `./scripts/deploy-9router.sh`, live `:20128`, smoke `:20129`.

- [ ] **Step 1: Verify commit range and dirty-file isolation**

Run:
```bash
git status -sb
git log --oneline origin/temp/merge-v0.5.6..HEAD
git diff -- .gitignore
```
Expected: only intentional commits are ahead; `.gitignore` remains unstaged.

- [ ] **Step 2: Push branch**

Run: `git push origin temp/merge-v0.5.6`
Expected: remote advances without force push.

- [ ] **Step 3: Deploy through the standard script**

Run: `./scripts/deploy-9router.sh`
Expected: build, `:20129` smoke, stage, swap, restart, and journal `DONE` all pass; rollback backup retained.

- [ ] **Step 4: Verify immutable live evidence**

Check live source stamp equals `git rev-parse HEAD`; `/api/health` is OK; `/api/version` reports expected current version; PM2 `9router` is online with no unstable restarts.

- [ ] **Step 5: Verify WARP/proxy behavior**

Perform one live `cx/gpt-5.6-sol` chat request expecting HTTP 200 and a deterministic marker. Inspect only new logs and verify no `Invalid URL protocol` or `falling back to direct` warning. Probe WARP health through an authenticated/local route context without exposing its configured URL.

- [ ] **Step 6: Verify reconciled storage safely**

Query SQLite for provider ID and boolean strict flags only. Expected: every `antigravity`, `xai`, and `github` row has top-level and nested `true`; print counts, never credentials.

- [ ] **Step 7: Verify dependency state in deployed artifact**

Inspect package metadata/lock provenance and run production audit in source. Expected: Undici and proxy-middleware targeted advisories absent.

### Task 8: Diagnose Antigravity Claude 404 separately

**Files:**
- Modify only after root cause: exact registry/executor file proven by trace.
- Create: `tests/unit/antigravity-claude-routing.test.js` if code defect is proven.

**Interfaces:**
- No network-hardening files may change.

- [ ] **Step 1: Reproduce with one targeted Claude request**

Use a known Antigravity account with non-empty `projectId`; capture HTTP status, upstream model ID, selected connection ID, and sanitized provider error. Do not print OAuth tokens or account secrets.

- [ ] **Step 2: Trace the complete routing seam**

Inspect model registry -> alias resolution -> credentials/project selection -> executor -> Google endpoint. Compare the requested SKU to the account's reported available models and distinguish code mapping from account entitlement.

- [ ] **Step 3: State one root-cause hypothesis and expected evidence**

If account/project cannot access the SKU, stop source changes and report the external blocker. If local routing emits the wrong endpoint/model/project, identify the exact pure function to test.

- [ ] **Step 4: For a proven code defect, write RED regression**

The test must supply the observed model/account inputs and assert the exact expected endpoint/model/project payload. Run it and confirm failure for the observed reason.

- [ ] **Step 5: Implement the smallest correction and verify**

Run the new test plus existing Antigravity routing/usage suites, build, isolated smoke, and one live request. Commit/deploy separately only when all pass.

### Task 9: Diagnose Antigravity Gemini null executor separately

**Files:**
- Modify only after root cause: exact executor factory/model-test file proven by trace.
- Create: `tests/unit/antigravity-gemini-executor.test.js` if code defect is proven.

**Interfaces:**
- No network-hardening or Claude-track files may change unless the same proven root cause requires it.

- [ ] **Step 1: Reproduce the null dereference**

Capture sanitized stack location and the inputs that caused executor selection to return null. Verify whether the failing path is generation, model test, or both.

- [ ] **Step 2: Trace executor construction**

Map provider/model format through executor factory and confirm why `getGenerativeModel` is called on null. Check model availability and `projectId` independently so external blockers are not misclassified.

- [ ] **Step 3: Write RED regression for the proven contract**

Assert either a valid executor is returned for a supported model or a structured unsupported-model error is returned before method invocation. Never merely suppress the null exception.

- [ ] **Step 4: Implement minimal fix and verify**

Run targeted executor/model-test suites, build, isolated smoke, and live request when account entitlement permits.

- [ ] **Step 5: Commit/deploy independently or report blocker**

Use a separate conventional commit and standard deployment only for a verified code fix. For missing entitlement/project/SKU, produce diagnosis evidence and no source mutation.

## Final Verification Checklist

- [ ] `git diff --check` passes and `.gitignore` remains unstaged.
- [ ] Installed dependency floors pass tests and production audit no longer reports the two targeted advisories.
- [ ] Shared dispatcher is the sole SOCKS connector implementation used by runtime and proxy test.
- [ ] TLS assertions prove hostname/certificate verification remains enabled.
- [ ] Sensitive providers fail closed at runtime and are reconciled at storage.
- [ ] WARP health response is bounded, authenticated by existing dashboard guard, and secret-free.
- [ ] Full production build and isolated smoke pass.
- [ ] Live source stamp, health, version, PM2, WARP route, and real chat request pass.
- [ ] Antigravity findings/fixes are isolated from network commits and based on reproduced root causes.
