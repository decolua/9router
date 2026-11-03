# Upstream v0.5.86 Retention Inventory

## Fork Features Retained (Since `a8c9d380`)
1. **Testing Studio & Playground** (`src/app/(dashboard)/dashboard/playground/*`)
2. **Provider Resilience & Proxy Pool Fitness** (`open-sse/services/proxyPoolFitness.js`, `open-sse/services/circuitBreaker.js`, `open-sse/services/adaptiveFailureClassifier.js`)
3. **Hard Quota & Provider Failure Tracking** (`open-sse/config/hardQuotaConfig.js`, `open-sse/services/providerFailureTracker.js`)
4. **Account Semaphore** (`open-sse/services/accountSemaphore.js`)
5. **New Providers** (`kenari`, `freebuff`)
6. **API Key Policy & Expiration** (`src/lib/db/repos/apiKeysRepo.js`, `src/lib/db/migrations/002-api-key-scopes-and-limits.js`)
7. **Combo Account Binding** (`src/shared/utils/comboModels.js`, `open-sse/services/combo.js`)
8. **UI Additions** (`src/app/(dashboard)/dashboard/providers/components/QuotaLockView.jsx`, `ProxyFitnessCard`)
9. **Docker Base** (npm ci is the install path; SQLite adapter fallback remains runtime behavior, lockfile retained)
10. **Test Coverage** (Maintained fork regression coverage; focused merge tests are staged but not run on Windows)

## Merge Conflict Areas Addressed
- **Dockerfile**: Retained `npm ci` but merged upstream's retry flags.
- **open-sse/handlers/chatCore.js**: Preserved fork's `onResilienceEvent` while keeping upstream's `toolNameMap` additions to `handleForcedSSEToJson`.
- **open-sse/services/usage/misc.js**: Kept upstream's refactor of Ollama usage (incorporating single monthly bucket) and retained fork's `2026-09` context comment.
- **src/app/(dashboard)/dashboard/combos/page.js**: Preserved fork's explicit connectionID configuration for combo models and custom descriptions, while integrating upstream's bulk actions and default preset generators.
- **src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js**: Kept fork's fallback/safety logic and comments.
- **src/lib/db/repos/usageRepo.js**: Preserved fork's optimized `apiKey` filtering alongside upstream's `OVERLAY_WINDOW_MS` performance enhancement.
- **tests/unit/ollama-usage.test.js**: Kept `SAMPLE_USAGE_MONTHLY` and added `SAMPLE_FREE_USAGE` for comprehensive unit test coverage.
- **tests/unit/usage-dispatch.test.js**: Combined fork's providers (`kenari`, `freebuff`) with upstream's `qoder-cn`.

## Verification Gaps & Regression Tests
- `aggregateComboCapabilities` now covers mixed string/object entries, nested combos, and preserves account bindings without mutating stored entries.
- System One policy and request accounting regression coverage is staged for homelab execution; Windows tests/builds are intentionally not run.
- Registry imports were manually corrected and checked for unique bindings, including fork providers `freebuff` and `kenari`; the generator was dry-run only.
- Known inherited semaphore, failed-response accounting, and OpenCode wildcard-prefix issues remain pre-existing and out of scope.
- Runtime receipt review found candidate-only groups: GLM-5.2 capability metadata, stale Claude version assertions, OpenCode fingerprint-tool expectations, and Qoder proxy transport semantics. Qoder now separates no-replay from explicit-proxy enforcement; no Windows test claim is made.
- OpenCode Free fingerprint decoys remain an upstream-required transport behavior; response-path tests verify caller tool-name restoration without suppressing unknown/injected tool calls.

Retention is staged, not verified: no claim is made that the full test suite passes.
