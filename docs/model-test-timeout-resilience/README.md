**Date:** 2026-10-28
**Feature:** Model Test Timeout Resilience & Graceful Error Handling

# Model Test Timeout Resilience Proposal: Extending Probe Timeouts and Error Handling for Reasoning Models & Multi-Account Fallbacks

This proposal addresses premature aborts and unhandled exceptions during model reachability tests on the 9Router dashboard (`/dashboard/providers/[id]`). The model testing probe (`pingModelByKind`) previously enforced a rigid 15-second timeout (`AbortSignal.timeout(15000)`) without local error handling. For reasoning models (such as Gemini 3.8 Flash, Gemini 3.7 Flash, DeepSeek-R1, and Kimi K3) or configurations with multiple provider accounts undergoing key failover, 15 seconds is often insufficient, triggering an unhandled `DOMException: The operation was aborted due to timeout` that bubbles up as an opaque HTTP 500.

By raising the default probe timeout to 60 seconds (`DEFAULT_MODEL_TEST_TIMEOUT_MS = 60000`, configurable via `MODEL_TEST_TIMEOUT_MS`) and wrapping probe dispatches in a resilient try/catch block with 504 Gateway Timeout semantics, models are given sufficient time to complete reasoning or fallback chains, and timeouts produce actionable status feedback instead of crash messages.

## 1. The Problem
1. **Premature Aborts on Reasoning Models:** Modern reasoning models generate chain-of-thought tokens before returning the final text. Empirical testing shows that Google Gemini 3.8 Flash can take ~40 seconds to process a prompt, while Gemini 3.5 Flash Lite took ~22.7 seconds. Under the former 15-second abort window, both models fail testing despite being fully functional.
2. **Account Failover Interruption:** When multiple provider accounts are configured with varying rate limits or temporary locks, 9Router rotates to the next account sequentially. If the initial key returns a late 429/502 and fallback takes >15 seconds cumulative, the probe aborts mid-flight.
3. **Unhandled Exception Propagation:** In `src/app/api/models/test/ping.js`, `fetch` calls had no local try/catch block. When `AbortSignal.timeout` expired, a raw Node.js `TimeoutError` / `DOMException` was thrown and caught at the root route handler (`route.js`), returning an unformatted HTTP 500 error string `"The operation was aborted due to timeout"`.

## 2. The Solution
1. **Adaptive 60s Timeout Window:** Introduce `DEFAULT_MODEL_TEST_TIMEOUT_MS = 60000` aligned with `FETCH_CONNECT_TIMEOUT_MS` (60s) used throughout `open-sse`. Allow runtime environment override via `process.env.MODEL_TEST_TIMEOUT_MS`.
2. **Graceful Error Handling in `pingModelByKind`:** Wrap the probe dispatch across all kinds (`embedding`, `image`, `stt`, `systemone`, and `llm`) in a structured try/catch block.
3. **HTTP 504 Timeout Feedback:** On timeout or abort, return `{ ok: false, latencyMs, status: 504, error: "Model probe timed out after 60s (upstream model took too long to respond or account fallback chain was slow)" }` instead of throwing an unhandled exception.
4. **Route Runtime Configuration:** Add `export const maxDuration = 60` to `src/app/api/models/test/route.js` to ensure the route handler accommodates reasoning probes.

---

## 3. General Implementation Guide

### Files Modified:
- `src/app/api/models/test/ping.js`:
  - Added `DEFAULT_MODEL_TEST_TIMEOUT_MS = 60000` and helper `getModelTestTimeoutMs()`.
  - Replaced hardcoded `AbortSignal.timeout(15000)` across all five modal kinds with `AbortSignal.timeout(timeoutMs)`.
  - Added comprehensive try/catch around `pingModelByKind` handling `TimeoutError`, `AbortError`, and network errors with appropriate HTTP status codes (504, 502, 500).
- `src/app/api/models/test/route.js`:
  - Added `export const maxDuration = 60;`.
- `tests/unit/ping-reasoning-models-3010.test.js`:
  - Added unit test cases for timeout handling (504 status) and general network probe errors.

---

## 4. Conclusion
With these enhancements, model reachability tests on the 9Router dashboard are resilient against long thinking latencies and multi-account failover delays. Users receive clear, descriptive diagnostics if a model genuinely exceeds the 60-second limit, eliminating premature timeout errors.

**Last Updated:** 2026-10-28
