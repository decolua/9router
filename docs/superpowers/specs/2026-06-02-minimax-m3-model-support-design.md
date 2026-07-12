# Design: Add MiniMax-M3 Model Support to 9router

**Date:** 2026-06-02
**Status:** Approved
**Approach:** Approach 1 — Minimal first-class model

## Problem

The 9router LLM router does not support the `MiniMax-M3` model for the two MiniMax providers:
- `minimax` (alias: `minimax`, name: "Minimax Coding", international endpoint)
- `minimax-cn` (alias: `minimax-cn`, name: "Minimax (China)", China endpoint)

When a user tries to use M3 via a custom model workaround:
1. Adding M3 as a custom model to one provider appears to "remove" it from the other provider (user-reported confusion)
2. The test button in the 9router UI returns `"Provider returned no completion choices for this model"` because the router cannot route the request without M3 in the model registry

## Goal

Add `MiniMax-M3` as a first-class built-in model for both `minimax` and `minimax-cn` providers, so that:
- M3 appears automatically in both providers' model lists (no custom model workaround needed)
- The test button works without errors
- Pricing is correctly tracked

## Solution

### File Changes

#### 1. `open-sse/config/providerModels.js`

Add `MiniMax-M3` to the `minimax` provider array (insert as first entry, line ~339):

```js
minimax: [
  { id: "MiniMax-M3", name: "MiniMax M3", targetFormat: "claude" },
  { id: "MiniMax-M2.7", name: "MiniMax M2.7" },
  { id: "MiniMax-M2.5", name: "MiniMax M2.5" },
  { id: "MiniMax-M2.1", name: "MiniMax M2.1" },
  { id: "minimax-image-01", name: "MiniMax Image 01", type: "image", params: ["n", "size", "response_format"] },
],
```

Add `MiniMax-M3` to the `minimax-cn` provider array (insert as first entry, line ~365):

```js
"minimax-cn": [
  { id: "MiniMax-M3", name: "MiniMax M3", targetFormat: "claude" },
  { id: "MiniMax-M2.7", name: "MiniMax M2.7" },
  { id: "MiniMax-M2.5", name: "MiniMax M2.5" },
  { id: "MiniMax-M2.1", name: "MiniMax M2.1" },
],
```

The `targetFormat: "claude"` flag tells the router to convert OpenAI-format requests to Anthropic Messages format before calling the upstream MiniMax API.

#### 2. `src/shared/constants/pricing.js`

Add pricing entry for M3 (Standard tier, ≤512k input tokens). The existing regex patterns `MiniMax-*` and `minimax-*` already cover M3 as a fallback, but explicit entries are added for clarity:

```js
// === MiniMax ===
"MiniMax-M3":    { input: 0.30,  output: 1.20,  cached: 0.06 },
"MiniMax-M2.7":  { input: 0.30,  output: 1.20,  cached: 0.06,  cache_creation: 0.375 },
"MiniMax-M2.5":  { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },
"MiniMax-M2.1":  { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },
"minimax-m3":    { input: 0.30,  output: 1.20,  cached: 0.06 },
"minimax-m2.7":  { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },
"minimax-m2.5":  { input: 0.60,  output: 2.40,  cached: 0.30,  reasoning: 3.60,   cache_creation: 0.60  },
```

Pricing source: MiniMax official pricing page (Standard Priority, ≤512k input tokens). M3 is intentionally simpler than M2.5 because the official pricing page only lists 3 fields (input, output, cache read) for M3.

### Files NOT changed

- **Custom model logic** (`src/lib/db/repos/aliasRepo.js`, `src/app/api/models/custom/route.js`) — M3 is now built-in, so users do not need to add it as a custom model
- **Test button endpoint** (`src/app/api/models/test/route.js`) — the test will work automatically once M3 is in `PROVIDER_MODELS`
- **UI components** (`ModelsCard.js`, etc.) — M3 will appear automatically in both providers
- **Pricing regex patterns** — existing patterns `MiniMax-*` and `minimax-*` already match M3

## Data Flow

### Test button flow (after fix)

```
1. User clicks test on ModelsCard for "minimax-cn"
   ↓
2. POST /api/models/test with { model: "minimax-cn/MiniMax-M3", kind: undefined }
   ↓
3. Test endpoint POSTs to /api/v1/chat/completions with model "minimax-cn/MiniMax-M3"
   ↓
4. Router resolves model: getModelsByProviderId("minimax-cn") returns [..., MiniMax-M3]
   → Model found ✓
   ↓
5. Format converter: targetFormat="claude" → convert OpenAI request to Anthropic Messages
   ↓
6. Upstream call to api.minimaxi.com/v1/text/chatcompletion_v2
   ↓
7. Response normalizer: Anthropic response → OpenAI format with choices array
   ↓
8. Test endpoint sees choices array → returns { ok: true, latencyMs: ... }
   ↓
9. UI shows green check mark ✓
```

### Model list flow

```
GET /v1/models
  → buildModelsList(["llm"])
  → for each active connection, get staticAlias → PROVIDER_MODELS[staticAlias]
  → for "minimax" connection: returns [MiniMax-M3, M2.7, M2.5, M2.1, ...]
  → for "minimax-cn" connection: returns [MiniMax-M3, M2.7, M2.5, M2.1]
  → models pushed to response as { id: "minimax/MiniMax-M3", owned_by: "minimax" }
  → also { id: "minimax-cn/MiniMax-M3", owned_by: "minimax-cn" }
```

## Why This Fixes the User-Reported Issues

### Issue 1: Test button error
**Root cause:** M3 is not in `PROVIDER_MODELS` → router cannot determine the upstream API format (Anthropic Messages vs OpenAI Chat Completions) → upstream returns response without `choices` array → test endpoint returns "no completion choices".

**Fix:** Adding M3 with `targetFormat: "claude"` tells the router to use Anthropic Messages format. The response normalizer converts the Anthropic response back to OpenAI format with a `choices` array.

### Issue 2: Custom model "overlap" confusion
**Root cause:** Custom models are stored in the kv table with a composite key `${providerAlias}|${id}|${type}`. Adding M3 as a custom model for `minimax` creates the key `minimax|M3|llm`. When the user opens the `minimax-cn` provider page, the filter `m.providerAlias === "minimax-cn"` excludes the M3 entry (which has `providerAlias === "minimax"`). The user perceives this as "M3 was removed from minimax-cn" but M3 was never added there.

**Fix:** By making M3 a built-in for both providers, no custom model workaround is needed. M3 appears in both provider model lists automatically.

## Error Handling

No new error handling needed. Existing flow:
- Unknown model ID → router returns HTTP 400 "model not found" (unchanged)
- Upstream error → response contains error field, test button shows error (unchanged)
- Network timeout → test button shows "Network error" (unchanged)

## Testing Checklist

- [ ] `PROVIDER_MODELS["minimax"]` contains `MiniMax-M3` with `targetFormat: "claude"` as first entry
- [ ] `PROVIDER_MODELS["minimax-cn"]` contains `MiniMax-M3` with `targetFormat: "claude"` as first entry
- [ ] `pricing.js` contains `"MiniMax-M3": { input: 0.30, output: 1.20, cached: 0.06 }`
- [ ] `pricing.js` contains `"minimax-m3": { input: 0.30, output: 1.20, cached: 0.06 }`
- [ ] `GET /v1/models` returns `minimax/MiniMax-M3` and `minimax-cn/MiniMax-M3`
- [ ] Test endpoint: `POST /api/models/test` body `{"model":"minimax/MiniMax-M3"}` returns `{ok: true, latencyMs: ...}`
- [ ] Test endpoint: `POST /api/models/test` body `{"model":"minimax-cn/MiniMax-M3"}` returns `{ok: true, latencyMs: ...}`
- [ ] ModelsCard for `minimax` renders MiniMax-M3 in the model list (no custom model add needed)
- [ ] ModelsCard for `minimax-cn` renders MiniMax-M3 in the model list (no custom model add needed)
- [ ] Existing models (M2.7, M2.5, M2.1) still work for both providers
- [ ] Lint passes on changed files
- [ ] Build passes (`npm run build`)

## Out of Scope

- Updating CHANGELOG.md (can be added in a follow-up commit if needed)
- Updating README / documentation
- Adding M3 to i18n translation files
- Adding M3 to suggested-models endpoint
- Tiered pricing for `>512k` input tokens (marked as limited availability in source)
- 7-day 50% promotional pricing
- Cache creation pricing for M3 (not listed in official pricing)

## Rollback

Revert the two file changes:
- `open-sse/config/providerModels.js` — remove the two `MiniMax-M3` entries
- `src/shared/constants/pricing.js` — remove the two pricing entries
