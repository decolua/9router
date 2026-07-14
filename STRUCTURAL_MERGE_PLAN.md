# 9router Structural Cleanup — Merge Plan & Safe Boundary

Author: Hermes (jago via 9router) | Date: 2026-07-14
Context: decolua/9router @ v0.5.30. Companion to CODE_REVIEW.md.

## CORRECTION to the earlier review
My first pass called `src/sse/` a "dead half-migrated shim." That was WRONG.
After tracing imports it is a **live parallel SSE engine**:
- `src/sse/handlers/chat.js`, `auth.js`, `tokenRefresh.js`, plus tts/fetch/search/
  imageGeneration/stt/embeddings handlers.
- The 6 `tests/translator/real/*.real.test.js` files import `checkAndRefreshToken`
  and `getProviderCredentials` from `src/sse/services/tokenRefresh.js` and
  `src/sse/services/auth.js`. Those tests are gated behind `RUN_REAL=1` (network +
  live provider creds) so they never run in default `vitest run`, but they ARE real
  and depend on `src/sse`.
- `src/sse/services/tokenRefresh.js` and `open-sse/services/tokenRefresh.js` share a
  NAME but export DIVERGENT symbol sets:
    - src/sse : checkAndRefreshToken, shouldRefreshCredentials, refresh*Token,
                releaseConnection, updateProviderCredentials, …
    - open-sse: getRefreshLeadMs, isUnrecoverableRefreshError, parseVertexSaJson,
                refreshVertexToken, refreshWithRetry (no checkAndRefreshToken)
  This is a naming-collision trap: two auth modules, same filename, different APIs.

Also corrected: `src/lib/oauth/providers.js` (1,681 lines) is NOT pure duplication of
the registry. The registry's `oauth` block carries `clientId`/`tokenUrl` but no
`mapTokens`/`pollToken`; those live ONLY in `src/lib/oauth/providers.js` and are
consumed by `open-sse/services/tokenRefresh/providers.js`. Collapsing it requires a
flow-merge, not a delete.

## What is verified-shippable (done — PR #2605)
- `getCredentialExpiryMs` derives expiry from `expiresIn` when `expiresAt` absent (#2546 class).
- `open-sse/services/credentialRefresh.js` facade.
- `resolveTransportCached` memoization, wired into chatCore + barrel.
- Tests green: credential-refresh-2546-class (7), resolve-transport-cache (2), grok-cli-expiresat (2).

## Test-environment boundary (why I stopped)
This checkout cannot run the repo's full suite: there is NO vitest config and NO module
alias wiring. `open-sse/...` and `@/...` bare specifiers fail to resolve under vitest
here (the repo's CI uses an uncommitted/Next-turbopack alias config). 79/122 unit files
pass; the 40 failures are 100% this resolution gap, not code defects. Engine-merge work
must be executed and verified in the repo's real CI, not here.

## Ordered merge plan (execute in repo CI, verify green between steps)
1. Consolidate to ONE auth module.
   - Pick `open-sse/services/tokenRefresh.js` as canonical. Move the symbols it lacks
     (`checkAndRefreshToken`, `shouldRefreshCredentials`, the `refresh*Token` fns,
     `releaseConnection`, `updateProviderCredentials`) into it from `src/sse`.
   - Add vitest alias `open-sse` → repo root `open-sse/` and `@` → repo root, so the
     merge can be verified locally. (This alias config is the missing piece.)
   - Repoint the 6 real-translator tests from `src/sse/...` to `open-sse/...`; run
     `RUN_REAL=1` only if live creds exist, else confirm the import graph compiles.
   - Delete `src/sse/` once nothing imports it.
2. Fold CLI provider OAuth into the registry.
   - Move `mapTokens`/`pollToken` from `src/lib/oauth/providers.js` into
     `open-sse/providers/registry/{grok-cli,gemini-cli,codebuddy-cn,kimi-coding}.js`
     `oauth` blocks. Point `open-sse/services/tokenRefresh/providers.js` at the registry.
   - Delete `src/lib/oauth/providers.js`; fix its 2 test importers.
3. Reduce `handleChatCore` arity.
   - Group the ~30 flat options into rtk/headroom/caveman/ponytail/pxpipe sub-objects.
   - Update the call sites (Next route + worker) in the same commit.
4. De-dup provider display constants.
   - `src/shared/constants/providers.js` and `providersDisplay.js` both import the
     registry; audit for duplicated provider metadata and centralize.

## Risk ordering
- #1 is the highest-payoff but highest-risk (merges two engines + touches RUN_REAL harness).
- #2 is moderate (clearly scoped, but wide import surface).
- #3/#4 are low-risk refactors.
Do #3/#4 first (safe wins), then #2, then #1 last with a full CI run.

## Verification gate
- `npx vitest run` green in repo CI (all unit + the non-real translator tests).
- `npx vitest run tests/translator/real/` at least import-resolves (RUN_REAL opt-in).
- `npm run build` (next build) succeeds.
