**Date:** 2026-11-21
**Feature:** Cloudflare Workers AI Clairic Model Support

# Cloudflare Clairic Proposal: Native System One Support for @cf/cloudflare/clairic and @cf/cloudflare/clairic-flash

This proposal introduces native support for Cloudflare's Clairic models (`@cf/cloudflare/clairic` and `@cf/cloudflare/clairic-flash`) under the Cloudflare Workers AI provider. Clairic is a specialized System One extraction and decision model that extracts, computes, estimates, and forecasts strongly typed values directly from unstructured input states.

Attempting to add or invoke `@cf/cloudflare/clairic` previously failed because the custom model modal lacked the System One modal type (causing users to mistakenly register it as a Chat/LLM model), and Cloudflare's Clairic endpoint strictly expects a `fields` schema (`required properties at '/' are 'model,fields'`) rather than the legacy `questions` schema used by older System One models like Clef.

By registering `@cf/cloudflare/clairic` and `@cf/cloudflare/clairic-flash` with `kind: "systemone"` and `upstreamModelId: "clairic"` / `"clairic-flash"`, accepting either `questions` or `fields` across System One request boundaries with automatic schema normalization, adapting probe tests, and expanding the custom model modal selector, Clairic is fully supported across both 9Router's dashboard and API endpoints.

## 1. The Problem
1. **Schema Incompatibility (`questions` vs `fields`):** Legacy System One models (such as Jev and Clef) require `{ state, questions }`. Cloudflare Workers AI's Clairic endpoints (`ai/run/@cf/cloudflare/clairic`) enforce `{ state, fields }` where `fields` defines strongly typed extractors (`text`, `number`, `boolean`, `date`, `list`, etc.). Passing `questions` to Clairic triggers an immediate Cloudflare 400 error: `AiError: Bad input: Error: required properties at '/' are 'model,fields'`.
2. **Missing System One in Custom Model Modal:** In `AddCustomModelModal.js`, the Model Type dropdown only offered `llm` (Chat) and `stt` (Speech to Text). Users attempting to register Clairic or custom decision models were forced to choose `llm`, routing requests to `/ai/v1/chat/completions` where Clairic is rejected as a non-chat model.
3. **Probe Validation Mismatch:** The model testing probe in `ping.js` previously only looked for `parsed?.answers`. Cloudflare's Workers AI endpoints wrap answers under `parsed.result.answers`, causing false negative test failures.

## 2. The Solution
1. **Registry Integration:** Registered `@cf/cloudflare/clairic` and `@cf/cloudflare/clairic-flash` directly in `open-sse/providers/registry/cloudflare-ai.js` under `kind: "systemone"` with short upstream model selectors (`clairic` and `clairic-flash`).
2. **Bi-Directional Schema Flexibility:** Updated `open-sse/handlers/systemoneCore.js` and `src/sse/handlers/systemone.js` to accept either `body.questions` or `body.fields`. When targeting Cloudflare Clairic, incoming `questions` payloads are automatically adapted into valid `fields` definitions (mapping legacy `noul` types to `boolean`).
3. **Usage & Response Normalization:** Added fallback handling for Cloudflare's nested `result.usage` and `result.answers` structures in `systemoneCore.js` and `ping.js`.
4. **Dashboard Parity:** Added the `systemone` option to the Model Type select in `AddCustomModelModal.js` so users can explicitly create and test custom System One models.

---

## 3. General Implementation Guide

### Files Modified:
- `open-sse/providers/registry/cloudflare-ai.js`: Added `@cf/cloudflare/clairic` and `@cf/cloudflare/clairic-flash` with `kind: "systemone"`.
- `open-sse/handlers/systemoneCore.js`: Enabled acceptance of `fields` or `questions`, auto-mapped `questions` to `fields` for Cloudflare Clairic, and parsed nested `result.usage`.
- `src/sse/handlers/systemone.js`: Updated input validation to accept either `questions` or `fields`.
- `src/app/api/models/test/ping.js`: Adapted System One test probe to query `fields` for Clairic and inspect `result.answers`.
- `src/app/(dashboard)/dashboard/providers/[id]/AddCustomModelModal.js`: Added `System One (Decision / Extraction)` to the Model Type selector.

---

## 4. Conclusion
Cloudflare Workers AI's Clairic models (`@cf/cloudflare/clairic` and `@cf/cloudflare/clairic-flash`) are now natively supported in 9Router. Users can invoke them via `/v1/systemone` using either native Clairic `fields` schemas or standardized `questions` payloads, and manage them effortlessly via the 9Router dashboard.

**Last Updated:** 2026-11-21
