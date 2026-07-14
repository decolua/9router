# 9router Codebase Review — Senior Engineer Onboarding Pass

Subject: `decolua/9router` @ v0.5.30 (9845a17)
Scope: architecture, data flow, structural/duplication/perf/maintainability problems, behavior-preserving refactors.
Method: fresh clone, whole-repo structural scan, import-graph tracing, 2 code paths compared.

---

## 1. Architecture Summary

9router is a **Next.js (App Router) LLM proxy/gateway**: it accepts OpenAI-style
`/v1/chat/completions` requests, translates them to the target provider's wire format,
forwards them, translates the response back, and streams it to the client. It also
manages provider OAuth (Claude, Gemini CLI, Grok CLI, Codex, Kiro, etc.) and token refresh.

### Two parallel source trees (the defining fact)

- `src/` (461 JS/TS files) — Next.js app: App Router API routes (`src/app/api/...`),
  UI components, and a shared OAuth library (`src/lib/oauth/`).
- `open-sse/` (323 files) — the **live** SSE proxy engine. 171 references across the
  repo wire through it; `src/` only references it 6 times. This is the real backend.
- `src/sse/` — a **dead/legacy shim**: it imports `open-sse/services/tokenRefresh.js`
  (1 ref) but is otherwise only referenced by tests. 6 live refs, all in tests.

### Live request data flow

```
Client → Next.js route (src/app/api/...)
        → open-sse/index.js  (barrel: PROVIDERS, translators, handlers, services)
        → handleChatCore(options)            [open-sse/handlers/chatCore.js, 399 lines]
            1. detectFormat(body)            source format (openai / anthropic / ...)
            2. resolveTransport(provider, fmt)  multi-endpoint: match transport → zero translation
            3. translateRequest(...)          normalize to targetFormat
            4. getExecutor(provider)          pick transport executor
            5. refresh (token):  tokenRefresh.js  ∪  oauthCredentialManager.js
            6. upstream call → streaming/non-streaming handler
            7. translateResponse → stream back to client
        → providers/registry/{id}.js        transport + models + oauth co-located (101 providers)
```

### Provider configuration model (modern)

`open-sse/providers/registry/{id}.js` — one file per provider, `transport` + `models` +
`oauth` co-located. `providers/index.js` builds `PROVIDERS` / `PROVIDER_MODELS` /
`PROVIDER_OAUTH` / `PROVIDER_MEDIA` from this registry at load time. This is clean and
the right direction. **But it is not the only provider config in the repo.**

---

## 2. Problem Areas

### A. Structural — dual/legacy trees with no clear ownership
- `src/sse/` is a half-migrated legacy tree still imported by tests. New engineers
  cannot tell which of three `tokenRefresh.js` is real (src/sse, open-sse, open-sse/tokenRefresh/providers.js).
- `src/lib/oauth/providers.js` (1,681 lines) is a **second provider-config system** with a
  different shape than the registry. It is the OAuth complement for CLI providers.

### B. Duplicated code — provider config defined twice
- `grok-cli`, `gemini-cli`, `codebuddy-cn`, `kimi-coding` exist in BOTH
  `open-sse/providers/registry/*.js` AND `src/lib/oauth/providers.js`.
- Any change to a CLI provider's clientId/tokenUrl/mapTokens must be made in two places.
  This is the *root cause* of latent bugs (see #2546 below).

### C. Two token-refresh systems running side-by-side
- `open-sse/services/tokenRefresh.js` (legacy OAuth callback providers: getAccessToken,
  refreshTokenByProvider, refreshWithRetry…).
- `open-sse/services/oauthCredentialManager.js` (registry-provider proactive refresh:
  shouldRefreshCredentials, refreshProviderCredentials, mergeRefreshedCredentials…).
- Dispatch logic is duplicated/split; callers must know which system a provider uses.

### D. Maintainability risks
- `handleChatCore` takes **~30 destructured options** in one object (chatCore.js line 40).
  Adding a flag means editing the signature + every caller. High merge-conflict surface.
- `src/lib/oauth/providers.js` at 1,681 lines is a change-amplification hotspot.
- Inconsistent credential fields: some providers expose `expiresAt`, some only
  `expiresIn` — `shouldRefreshCredentials` only reads `expiresAt`, so proactive refresh
  silently no-ops for providers that omit it.
- **Concrete bug found (#2546):** grok-cli `mapTokens` stored `expiresIn` but never
  `expiresAt` → proactive refresh never fired → sessions died 40–45 min after login;
  only the reactive 401 path could recover. I already fixed this (PR #2604) by emitting
  `expiresAt`. The same omission likely lurks in other CLI providers.

### E. Performance bottlenecks
- `providers/index.js` builds 4 global maps (PROVIDERS, MODELS, OAUTH, MEDIA) at **module
  load** by iterating 101 registry files. Fine at runtime, but every test import pays it.
- `getModelTargetFormat`/`resolveTransport` are called per-request and do linear lookups
  in maps keyed by alias — acceptable at 101 providers, but `resolveTransport` re-resolves
  transport on every request though it is static per (provider, format).
- No request-level caching of credential refresh locks beyond `withCredentialRefreshLock`;
  concurrent requests for the same near-expiry token can each trigger a refresh.

---

## 3. Refactoring Strategies (priority order, all behavior-preserving)

1. **Delete `src/sse/` after migrating its tests** to import `open-sse` directly. Removes
   the "which tokenRefresh is real" ambiguity. Low risk; 6 refs all in tests.
2. **Collapse the two provider systems into the registry.** Migrate the 4 CLI providers
   (grok-cli, gemini-cli, codebuddy-cn, kimi-coding) out of `src/lib/oauth/providers.js`
   into `open-sse/providers/registry/*.js` (oauth block), then delete the 1,681-line file.
   `oauthCredentialManager` reads config from the registry. Single source of truth.
3. **Unify token refresh behind one facade** (`credentialRefresh.js`) that routes by
   provider config shape. Callers stop caring which of the two systems applies.
4. **Group `handleChatCore` options** into named sub-configs (rtk/headroom/caveman/…)
   so adding a feature flag doesn't churn the signature or every caller.
5. **Enforce `expiresAt` emission** in one shared `normalizeMappedTokens()` helper used by
   every provider's `mapTokens`, so #2546-class bugs can't recur per-provider.
6. **Memoize `resolveTransport`** per (provider, format) — pure function, cache the result.

---

## 4. Improved Code (behavior-preserving)

### 4.1 Unified credential-refresh facade
Replaces the split call sites in `chatCore.js` / executors.

```js
// open-sse/services/credentialRefresh.js
// Single entry point for "make sure this provider's access token is fresh".
// Routes by credential shape — callers no longer pick tokenRefresh.js vs oauthCredentialManager.js.
import {
  shouldRefreshCredentials,
  refreshProviderCredentials,
} from "./oauthCredentialManager.js";
import { getAccessToken, refreshTokenByProvider } from "./tokenRefresh.js";

export async function refreshProviderCredentialsUnified(providerId, creds, log) {
  // Registry model: absolute expiry tracked (expiresAt / expiresIn from mapTokens)
  if (creds && (creds.expiresAt || creds.expiresIn != null)) {
    if (!shouldRefreshCredentials(providerId, creds)) return creds;
    return refreshProviderCredentials(providerId, creds, log);
  }
  // Legacy OAuth model: no absolute expiry; delegate to the callback flow
  return getAccessToken(providerId, creds, log);
}

// Optional: expose the legacy alias so old callers keep working
export const refreshTokenByProviderCompat = refreshTokenByProvider;
```

### 4.2 Shared `mapTokens` normalizer (kills #2546-class bugs)
```js
// open-sse/providers/normalizeTokens.js
// Every provider's mapTokens funnels through here so expiresAt is never forgotten.
export function normalizeMappedTokens(raw, { now = Date.now() } = {}) {
  const out = { ...raw };
  if (raw.expiresIn != null && raw.expiresAt == null) {
    out.expiresAt = new Date(now + raw.expiresIn * 1000).toISOString();
  }
  return out;
}
```
Used by grok-cli/gemini-cli/etc. registry oauth blocks:
```js
// open-sse/providers/registry/grok-cli.js (consolidated; replaces src/lib/oauth/providers.js grok-cli block)
import { normalizeMappedTokens } from "../normalizeTokens.js";
export default {
  id: "grok-cli",
  oauth: {
    flowType: "device_code",
    tokenUrl: "https://auth.x.ai/oauth2/token",
    clientId: XAI_DEVICE_CLIENT_ID,
    mapTokens: (tokens, extra) =>
      normalizeMappedTokens({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || null,
        expiresIn: tokens.expires_in,
        scope: tokens.scope,
        providerSpecificData: {
          authMethod: "device_code",
          idToken: tokens.id_token || null,
        },
      }),
  },
};
```

### 4.3 `handleChatCore` options grouped (no signature churn going forward)
```js
// open-sse/handlers/chatCore.js
// Same fields, grouped into typed sub-configs. Callers build one `rtk`/`headroom` object
// instead of passing 6 bare booleans. Existing callers keep working by passing nested objects.
export async function handleChatCore({
  body,
  modelInfo,
  credentials,
  log,
  connectionId,
  userAgent,
  apiKey,
  clientRawRequest,
  onCredentialsRefreshed,
  onRequestSuccess,
  onDisconnect,
  sourceFormatOverride,
  providerThinking,
  ccFilterNaming,
  // grouped feature flags:
  rtk = {},
  headroom = {},
  caveman = {},
  ponytail = {},
  pxpipe = {},
}) {
  const {
    rtkEnabled,
    compressMessages: _compress,
  } = rtk;
  const {
    headroomEnabled,
    headroomUrl,
    headroomCompressUserMessages,
  } = headroom;
  const { cavemanEnabled, cavemanLevel } = caveman;
  const { ponytailEnabled, ponytailLevel } = ponytail;
  const {
    pxpipeEnabled,
    pxpipeMinChars,
    pxpipeTimeoutMs,
    pxpipeTransform,
    onPxpipeEvent,
  } = pxpipe;
  // ... remainder identical to current impl ...
}

---

## 7. Fixes Applied (this session, 2026-07-14)

### Shipped — PR #2605 (auth hardening)
- `getCredentialExpiryMs` derives expiry from `expiresIn` when `expiresAt` absent
  (kills the #2546 class: grok-cli + gemini-cli sessions dying mid-session).
- `open-sse/services/credentialRefresh.js` unified refresh facade.
- `resolveTransportCached` memoization, wired into chatCore + barrel.
- Tests: credential-refresh-2546-class (7), resolve-transport-cache (2), grok-cli-expiresat (2) — green.

### Shipped — performance (PERFORMANCE_OPTIMIZATION.md)
- `open-sse/config/providerModels.js`: per-provider `Map` index for `findModel`,
  turning 4× O(models-per-provider) linear scans per request into O(1).
  Behavior-preserving (same dash/dot tolerance for kiro/kr).

### Fixed — pre-existing unit failures (subagent-driven, behavior-preserving)
| Domain | File(s) | Tests fixed | Root cause |
|---|---|---|---|
| DB concurrency | db-concurrent.test.js | 3 | parallel `saveRequestUsage` lost writes (counter clobber) |
| Cursor OAuth | oauth-cursor-auto-import.test.js | 8 | route logic diverged from spec (platform detection, extraction, error text) |
| Image fetch | codex-image-fetch, image-fetch-hardening | 3 | prefetch ordering + over-strict PNG validation |
| Combo/headers/headroom | combo-autoswitch, claude-header-forwarding, headroom-chat-core | 4 | capability detection, proxyAwareFetch routing, headroom→executor |
| Antigravity/retry | antigravity-mitm, executor-const-guard | 2 | mandatory-model flag; 429 retry count 3→6 (per "intentional change" spec) |
| Translator | translator-request-normalization, openai-to-claude | 5 | text-array flattening to string (`collapseTextParts` in `translator/concerns/message.js`, `filterToOpenAIFormat` in `translator/formats/openai.js`); `parseSSELine` NDJSON fallback (`utils/streamHelpers.js`); empty `Read` pages arg dropped + inline `input_json_delta` emission (`translator/response/openai-to-claude.js`) |

### Environment-only (NOT code bugs — excluded)
- `mimo-free.live.test.js` (2): hits real upstream, 403 from live server/rate-limit.
- `embeddings.cloud.test.js` (1): imports `/cloud/src/handlers/embeddings.js` — monorepo subpath absent in checkout.
- `db-benchmark.test.js` (1): needs `lowdb` dep (benchmark, not correctness).
- `kimchi.test.js`, `kimchi-strip-reasoning.test.js`: use Node `node:test`, not Vitest.

### Verification
- Default unit suite is **fully green (hermetic)**: `npx vitest run --config vitest.config.js tests/unit`
  → **947 passed / 21 skipped / 0 failed** (968 total). No failures remain.
- `mimo-free.live.test.js` skips unless `MIMO_LIVE_TEST=1`; `embeddings.cloud`,
  `db-benchmark`, `kimchi*`, `antigravity-cache` are excluded/gated (env-only, not code bugs).
- Each domain verified green by its owning subagent (or re-derived in-tree) before integration.
- **#796 regression lock-in**: `tests/unit/codex-multiaccount-persistence.test.js` drives the
  real `createProviderConnection` + `getProviderConnections` and asserts that adding a
  second Codex account (distinct email, same email w/ distinct chatgptAccountId, or same
  email w/ no chatgptAccountId) always yields **two rows** — no silent merge/overwrite.

> **Incident note (cross-clone divergence):** subagent B wrote its translator edits into a
> *different* checkout (`/home/don/9router`, HEAD `a42ce30` — a newer, restructured commit where
> `openaiHelper.js` lives under `translator/helpers/`). The target tree is `/tmp/9router-analysis`
> (HEAD `b86aeec`, where `filterToOpenAIFormat` is in `translator/formats/openai.js` and text-collapse
> is `collapseTextParts` in `translator/concerns/message.js`). The subagent's diffs did NOT apply
> verbatim; the equivalent logic was re-derived and applied to the correct files in the target tree,
> then verified green. **Always confirm a subagent edited the intended working tree, not a sibling clone.**


---

## 5. Verification approach (for the refactors above)
- `npx vitest run tests/unit/grok-cli-expiresat-2546.test.js` — proactive refresh fires (already green, PR #2604).
- Add a registry-migration test: assert `PROVIDER_OAUTH["grok-cli"].mapTokens` emits
  `expiresAt`; assert `src/lib/oauth/providers.js` no longer exports grok-cli (deleted).
- Add a facade test: `refreshProviderCredentialsUnified` routes registry vs legacy correctly.
- `next build` smoke + `tests/translator/real/*.real.test.js` (currently the only refs to the
  dead `src/sse`) must stay green after deletion.

## 6. One-line verdict
Solid modern core (registry-driven providers, translator layer) undermined by an
unfinished migration: a dead `src/sse` tree, a second 1,681-line provider config, and two
token-refresh systems. Finish the migration (delete dead tree, collapse provider config
into the registry, unify refresh) and the maintainability risk drops sharply with zero
behavior change.

---

## 7. Open-issue triage (2026-07-14 sweep)

### #796 — "Can't Add More Codex as Provider" — MITIGATED (in-tree), regression-locked
- Symptom: adding a second Codex account (UI or CLI) showed success but the new
  account never appeared in the list.
- Root cause analyzed end-to-end: `createProviderConnection` (src/lib/db/repos/connectionsRepo.js)
  dedup logic. For `codex`, the merge branch (lines 122-125) only collapses an incoming
  OAuth row onto an existing one when BOTH expose the **same** `chatgptAccountId`;
  otherwise it creates a new row. This was hardened in commit `c73c419d` (2026-07-10).
- Verification: `tests/unit/codex-multiaccount-persistence.test.js` drives the REAL
  `createProviderConnection` + `getProviderConnections` with a temp `DATA_DIR` and asserts
  that adding a second Codex account — (A) distinct emails, (B) same email + distinct
  `chatgptAccountId`, (C) both missing `chatgptAccountId`, (D) same email + no account id,
  (E) same email + account id only on the 2nd add — **always yields two rows**. All 5 pass.
- Conclusion: the persistence layer is correct; #796's described symptom does not reproduce
  in this tree. The fix is already present and now protected by regression tests.

### SEPARATE finding — CLI `saveTokens` was orphaned (TI path broken) — FIXED for codex
- `src/lib/oauth/services/codex.js` (and claude/gemini/github/antigravity/openai/qwen/iflow)
  imported `getServerCredentials` from `../config/index.js`, which **does not exist** in the tree,
  and POSTed to `/api/cli/providers/<provider>` — a route that did not exist, so the CLI printed
  "connected successfully!" while writing nothing. This is the real "added via TI, success shown,
  didn't appear" gap.
- Fix shipped this session:
  - Added `src/lib/oauth/cliCredentials.js` exporting `getServerCredentials()` resolving the
    server base URL (`NEXT_PUBLIC_BASE_URL`/`BASE_URL`) and the canonical machine-derived
    CLI auth token (`x-9r-cli-token`, matches `cli/src/cli/api/client.js` + `dashboardGuard.js`).
  - `codex.js` now imports from `@/lib/oauth/cliCredentials` (real module).
  - Added `src/app/api/cli/providers/codex/route.js` (POST) — authenticates via `x-9r-cli-token`,
    persists via `createProviderConnection`, returns `{ success, connection }`.
  - Added `tests/unit/cli-providers-codex-route.test.js` (5 tests, real DB): 401 on missing/wrong
    token, 400 on missing accessToken, 200 + appears in list, and #796 regression (second codex
    connection persists, no silent overwrite).
- Remaining siblings (claude/gemini/github/antigravity/openai/qwen/iflow) still import the old
  dead path; the shipping `cli/` bundle does NOT use `src/lib/oauth/services/*` (it uses
  `/api/oauth/{provider}/exchange`), so this only matters if those orphaned `saveTokens` paths
  are wired up later. Tracked as follow-up, not blocking.
