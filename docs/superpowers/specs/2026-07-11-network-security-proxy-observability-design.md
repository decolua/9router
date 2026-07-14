# 9router Network Security, Proxy Consistency, and WARP Observability Design

**Date:** 2026-07-11
**Status:** Approved design, pending written-spec review
**Scope:** Dependency hardening, shared proxy dispatcher, strict-proxy reconciliation, sanitized WARP health, and isolated Antigravity investigation

## Purpose

Harden 9router's outbound proxy path after adding SOCKS support, eliminate the capability mismatch between runtime requests and dashboard proxy tests, preserve fail-closed routing for sensitive providers, expose safe WARP health signals, and investigate Antigravity failures without conflating provider defects with network behavior.

## Goals

1. Upgrade proxy-relevant dependencies past known high-severity advisories.
2. Give runtime requests and dashboard proxy tests one shared dispatcher contract.
3. Preserve hybrid routing: sensitive providers fail closed; other providers retain global failover behavior.
4. Reconcile existing sensitive connection rows without exposing or rewriting credentials.
5. Expose sanitized WARP readiness information for operations.
6. Investigate and fix Antigravity failures only after reproducing their actual root causes.

## Non-Goals

- Do not switch all providers to global fail-closed routing.
- Do not disable `strictProxy` to make requests succeed.
- Do not use WARP or MITM to bypass IAM, missing `projectId`, account entitlement, or unavailable model SKUs.
- Do not mutate credentials, tokens, cookies, or OAuth material during reconciliation.
- Do not combine speculative Antigravity fixes with the network-hardening deployment.
- Do not modify the unrelated dirty `.gitignore`.

## Architecture

### 1. Dependency Security

Upgrade independently:

- `undici` to `>=7.28.0`.
- `http-proxy-middleware` to `>=3.0.7`.

Each upgrade has an isolated test gate. The Undici gate must cover the SOCKS connector, HTTP/HTTPS proxy dispatcher selection, TLS wrapping, strict-proxy failure behavior, and a real local WARP smoke test. Dependency upgrades must not weaken certificate or hostname validation.

### 2. Shared Proxy Dispatcher Module

Create a focused module at:

```text
src/lib/network/proxyDispatcher.js
```

Public interface:

```js
createProxyDispatcher(proxyUrl)
disposeProxyDispatcher(dispatcher)
isSocksProxyUrl(proxyUrl)
createSocksConnector(proxyUrl)
```

Responsibilities:

- Normalize and validate proxy URLs.
- Route `http:` and `https:` through `undici.ProxyAgent`.
- Route `socks5:`, `socks5h:`, `socks4:`, and `socks4a:` through `undici.Agent({ connect })` and `SocksClient.createConnection`.
- TLS-wrap HTTPS destination sockets with certificate verification, SNI, and HTTP/1.1 ALPN.
- Dispose dispatchers using best-effort `destroy()`, falling back to `close()`.

Consumers:

- `open-sse/utils/proxyFetch.js` uses the module for cached runtime dispatchers.
- `src/lib/network/proxyTest.js` uses the same module for one-shot dashboard/provider proxy tests and always disposes its dispatcher.

DNS semantics are intentionally privacy-preserving: destination hostnames are passed to the SOCKS proxy for all supported SOCKS schemes. This avoids local DNS leakage. The code and tests must document that behavior explicitly rather than implying conventional local-DNS semantics for plain `socks5:`.

### 3. Hybrid Strict-Proxy Policy

Global outbound mode remains `failover` for compatibility. The following providers are always sensitive:

```text
antigravity
xai
github
```

For these providers, effective `strictProxy` must always be `true` at both boundaries:

1. **Write boundary:** connection create, import/deduplication merge, and update persist top-level and nested strict flags.
2. **Runtime auth boundary:** credential assembly forces strict behavior even if existing storage has drifted.

Provider IDs, not mutable account names, define the policy. Therefore all GitHub connections are strict, not only a connection named `Account 2`.

### 4. Existing-Data Reconciliation

Add an idempotent initialization reconciliation that:

1. reads provider connection records;
2. identifies sensitive provider IDs;
3. changes only rows missing either strict flag;
4. sets both:

```js
strictProxy: true
providerSpecificData.strictProxy: true
```

5. commits changes atomically where the repository's DB abstraction permits;
6. logs only the repaired row count.

It must not print or alter credential values. Runtime auth enforcement remains in place as defense in depth even after reconciliation.

### 5. Sanitized WARP Health

Add a bounded health service and authenticated dashboard API surface. The service checks:

1. whether outbound proxy is enabled and configured;
2. whether the configured proxy can make a request within a short timeout;
3. whether Cloudflare trace reports `warp=on`;
4. how many sensitive connections are currently strict at both storage fields.

Response shape:

```json
{
  "configured": true,
  "reachable": true,
  "warp": true,
  "strictConnections": 11,
  "checkedAt": "2026-07-11T15:00:00.000Z"
}
```

Failure states remain sanitized and distinguish at least:

- not configured;
- proxy unreachable;
- proxy reachable but WARP off;
- healthy.

The API must never return proxy URLs, usernames, passwords, emails, cookies, tokens, raw Cloudflare trace output, or connection payloads. Health probes are observational only and never modify routing or storage.

### 6. Antigravity Investigation Track

This work begins only after the network-hardening deployment is independently validated.

Two symptoms are investigated separately:

1. Claude-family requests returning Google `404 Requested entity was not found`.
2. Gemini-family requests failing because an executor is null before `getGenerativeModel`.

For each symptom:

1. reproduce with a targeted request and sanitized logs;
2. trace model registry, account/project entitlement, executor selection, and error propagation;
3. form one root-cause hypothesis;
4. write a failing regression test;
5. implement the smallest correction;
6. verify targeted tests, build, isolated smoke, and a live request if credentials permit.

A missing `projectId`, IAM denial, or unavailable SKU is reported as an external/account blocker rather than patched with random project fallback.

## Data Flow

### Runtime Request

```text
connection data
  -> strict proxy policy
  -> resolved proxy configuration
  -> shared dispatcher factory
  -> HTTP ProxyAgent or SOCKS Agent
  -> upstream provider
```

If the provider is sensitive and dispatcher creation or proxy transport fails, the request fails. It never calls the direct fetch fallback.

### Dashboard Proxy Test

```text
sanitized proxy-test request
  -> shared dispatcher factory
  -> one-shot request
  -> normalized result
  -> dispatcher disposal
```

Dashboard test capability therefore matches runtime proxy capability.

### WARP Health

```text
settings + strict connection count
  -> bounded proxy trace probe
  -> parsed warp flag
  -> sanitized health DTO
```

## Error Handling

- Unsupported proxy schemes return a structured validation failure.
- SOCKS negotiation and TLS errors preserve meaningful causes but redact proxy credentials.
- Dispatcher disposal failures are ignored after best-effort cleanup and do not mask the primary request result.
- Sensitive-provider proxy failures fail closed.
- Non-sensitive providers retain existing failover semantics.
- WARP health timeout returns an unhealthy status; it does not throw an unhandled route error.
- Reconciliation failure follows the repository's initialization error policy and never silently reports repaired rows.

## Testing Strategy

All behavior changes follow RED -> GREEN -> REFACTOR.

### Dependency and TLS Tests

- Installed Undici version is at least `7.28.0`.
- HTTP/HTTPS URLs produce `ProxyAgent`.
- SOCKS URLs produce `Agent` with a custom connector.
- HTTPS destinations are TLS-wrapped with SNI and certificate verification enabled.
- Connector errors propagate.
- `strictProxy=true` never invokes direct fallback.

### Shared Dispatcher Tests

- Runtime and `proxyTest` use the shared factory.
- Invalid protocol is rejected consistently.
- One-shot proxy tests dispose dispatchers.
- Runtime cache eviction/reset disposes dispatchers.
- Remote-DNS semantics are documented and asserted for all supported SOCKS schemes.

### Reconciliation Tests

- Sensitive rows with false/missing flags are repaired.
- Already-compliant rows are unchanged.
- Non-sensitive rows are unchanged.
- Existing nested provider data and credentials are preserved.
- Repeated reconciliation is idempotent.
- Logs contain counts only.

### WARP Health Tests

- not-configured response;
- proxy unreachable response;
- proxy reachable with `warp=off` response;
- healthy `warp=on` response;
- strict connection count;
- secret and proxy URL fields never appear in the DTO.

### Regression and Release Gates

- Relevant proxy/security unit suites.
- Connection repository and auth suites.
- API route tests for WARP health.
- `node --check` or repository lint for touched files.
- Production build.
- Isolated smoke on `:20129`.
- Live source stamp, health, version, PM2 status.
- Real request through WARP with no direct-fallback warning.
- Live DB verification that sensitive rows have both strict flags.
- Production audit confirms the targeted advisories are removed.

## Delivery Boundaries

### Commit A: Network hardening

- Undici upgrade.
- Shared dispatcher extraction.
- Dashboard proxy-test alignment.
- TLS/SOCKS regressions.

### Commit B: Policy and observability

- Strict-proxy reconciliation.
- Sanitized WARP health service/API.
- `http-proxy-middleware` upgrade.

Deploy A and B together only after the combined build and smoke gates pass. Preserve a rollback backup through the standard deployment script.

### Commit C or later: Antigravity

Antigravity fixes are committed and deployed separately per proven root cause. Account/IAM blockers may result in a diagnosis-only report rather than a source change.

## Acceptance Criteria

- `undici >=7.28.0` and `http-proxy-middleware >=3.0.7` are installed and locked.
- Runtime and proxy-test paths share one protocol-aware dispatcher interface.
- SOCKS/WARP proxy tests work without `Invalid URL protocol` errors.
- Sensitive providers cannot fall back to direct traffic.
- Existing sensitive rows are reconciled idempotently.
- WARP health is observable without exposing sensitive details.
- Global routing remains hybrid.
- Targeted audit findings are resolved.
- Build, isolated smoke, deployment, and live request verification pass.
- Antigravity work remains isolated and is fixed only where a regression test proves the root cause.
