# 9router Performance Optimization Analysis

Author: Hermes (jago via 9router) | Date: 2026-07-14
Subject: decolua/9router @ v0.5.30. Companion to CODE_REVIEW.md + STRUCTURAL_MERGE_PLAN.md.

Goals assessed: Speed (latency per request), Memory (per-process footprint),
Scalability (concurrent requests, cold start, model-count growth).

## Hot-path data flow (per request)
```
request → detectFormat → getModelTargetFormat / getModelUpstreamId / getModelStrip
        → resolveTransport (cached, PR #2605) → translateRequest → getExecutor
        → token refresh (shouldRefreshCredentials) → upstream call → stream back
```

## Bottlenecks found

### 1. Per-request linear model lookup (FIXED)
`open-sse/config/providerModels.js` `findModel()` did `models.find(m => m.id === id)`
— an O(N) scan over a provider's model list. It is called up to **4× per request**
(`getModelTargetFormat`, `getModelStrip`, `getModelType`, `getModelUpstreamId`),
each over the full model array (some providers expose 100+ models). That is
O(4 × models-per-provider) of redundant scanning on the critical path.

**Fix applied:** build a per-provider `Map<modelId, entry>` index once at module
load (plus a normalized-id secondary Map for DOT_VERSION_PROVIDERS), and route
`findModel` through it. Lookups are now O(1). Behavior-preserving (same match
semantics, including dash/dot tolerance for kiro/kr). See `providerModels.js`.
Verified: provider-models-minimax-m3, provider-test-models-routing,
provider-custom-models tests pass; full unit suite 942/968 green (2 live-only fails).

### 2. Module-load build cost (scalability / cold start)
`open-sse/providers/index.js` builds 4 global maps (PROVIDERS, PROVIDER_MODELS,
PROVIDER_OAUTH, PROVIDER_MEDIA) by iterating 101 registry files at import time.
Paid once per process, but ALSO paid by every `vitest` import and every cold
start / serverless invocation. With 101 providers it is microseconds-to-ms,
acceptable — but it is pure and could be lazy/parallelized if cold-start budget
tightens. Low priority; not changed.

### 3. Concurrent token-refresh not deduplicated
`withCredentialRefreshLock` serializes refreshes per connection, but two requests
for the *same* near-expiry token that both pass the `shouldRefreshCredentials`
check can each fire a refresh before the first completes (TOCTOU). Each refresh
is a network round-trip to the OAuth provider. Recommend a single-flight /
promise-cache keyed by connectionId so only one refresh runs; others await it.
(Safe, additive — proposed, not applied here to keep this change scoped.)

### 4. Streaming (no allocation hot loop found — good)
`open-sse/utils/streamHandler.js` (254 lines) has **zero** JSON.parse/stringify/
RegExp/replace in the per-chunk path. SSE chunks pass through with minimal
allocation. No change needed. This is already well-optimized.

### 5. `translateRequest` runs for every request
Translation is necessary (multi-format proxy), but for the common case where
source format === target format (same-provider, no translation needed) it still
runs the full translate pipeline. `resolveTransport` already short-circuits to
"zero translation" when a transport matches the source format; ensure
`translateRequest` also early-returns the unmodified body in that case to avoid
needless concern passes (thinking/modality/prefetch). Proposed micro-opt.

## Optimization strategies (priority)
1. ✅ Model lookup index — DONE (this session). Removes 4× O(N) scan/request.
2. ⬜ Single-flight token refresh (promise-cache by connectionId).
3. ⬜ `translateRequest` no-op fast path when source===target format.
4. ⬜ Lazy/parallel provider-map build if cold-start budget matters.

## Memory
- The 4 global provider maps hold all 101 providers' config + models in memory
  for the process lifetime. At 101 providers this is modest (KBs–low MBs). Not a
  concern. If provider count grows 10×, revisit (the index added in #1 adds one
  Map per provider — linear, fine).
- `requestDetail` observability batches writes (batchSize) — good for memory
  under high throughput (see db-concurrent "200 parallel saveRequestDetail").

## Result summary
- Applied: O(1) model resolution (per-request win, scales with model count).
- Proposed (safe, additive, out of scope for this change): single-flight refresh,
  translate no-op fast path, lazy provider-map build.
- Streaming path verified already optimal.

## Proposed optimization A — memoize `resolveTransport` (pure, static per provider+format)
`resolveTransport` is pure and depends only on `(provider, sourceFormat)`. It is
invoked on every request. Memoize per key:
```js
// open-sse/services/provider.js
const _transportCache = new Map();
export function resolveTransport(provider, sourceFormat) {
  const key = provider + "|" + sourceFormat;
  if (_transportCache.has(key)) return _transportCache.get(key);
  const t = _resolveTransportImpl(provider, sourceFormat);
  _transportCache.set(key, t);
  return t;
}
```
Combined with the model-index (#1) this removes the two remaining repeated lookups
on the critical path. Note: `resolveTransportCached` already exists (PR #2605) in the
transport facade — prefer extending that cache rather than adding a second one.
