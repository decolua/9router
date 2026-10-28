/**
 * Regression tests for #4271 and #4369
 *
 * #4271: Combo model aborts on model-scoped 400 (unentitled model) or 410 (EOL)
 *        instead of trying the next member.
 * #4369: Codex ChatGPT accounts return HTTP 400 "model is not supported when
 *        using Codex with a ChatGPT account" — should trigger combo fallback.
 *
 * Fix: Add text-based ERROR_RULES entries for the specific account+model-scoped
 *      messages, plus a status rule for HTTP 410 (Gone / end of life).
 */

import { describe, it, expect } from "vitest";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

describe("checkFallbackError — combo fallback for model-scoped 4xx (#4271 / #4369)", () => {
  // ── HTTP 410 Gone ──────────────────────────────────────────────────────────
  it("410 Gone triggers fallback (model retired / EOL)", () => {
    const r = checkFallbackError(410, "Gone");
    expect(r.shouldFallback).toBe(true);
    expect(r.cooldownMs).toBeGreaterThan(0);
  });

  it("410 with EOL body triggers fallback", () => {
    const msg = "The model 'gpt-5.6-sol' has reached its end of life on 2026-09-01 and is no longer available.";
    const r = checkFallbackError(410, msg);
    expect(r.shouldFallback).toBe(true);
  });

  // ── HTTP 400 — Codex ChatGPT account entitlement ──────────────────────────
  it("400 'not supported when using codex with a chatgpt account' triggers fallback", () => {
    const msg = "The 'gpt-5.6-sol' model is not supported when using Codex with a ChatGPT account.";
    const r = checkFallbackError(400, msg);
    expect(r.shouldFallback).toBe(true);
    expect(r.cooldownMs).toBeGreaterThan(0);
  });

  it("400 'model_entitlement' triggers fallback", () => {
    const r = checkFallbackError(400, "model_entitlement: account cannot use this model");
    expect(r.shouldFallback).toBe(true);
  });

  it("400 'end of life' text triggers fallback", () => {
    const r = checkFallbackError(400, "This model has reached its end of life.");
    expect(r.shouldFallback).toBe(true);
  });

  // ── Generic 400 — request-scoped errors still do NOT fallback ─────────────
  it("generic 400 (context overflow) does NOT trigger fallback", () => {
    const r = checkFallbackError(400, "This model's maximum context length is 128000 tokens.");
    expect(r.shouldFallback).toBe(false);
  });

  it("generic 400 (malformed body) does NOT trigger fallback", () => {
    const r = checkFallbackError(400, "Invalid value for parameter 'temperature': 3.0 is too large.");
    expect(r.shouldFallback).toBe(false);
  });

  // ── Already-covered statuses still work ───────────────────────────────────
  it("401 still triggers fallback", () => {
    expect(checkFallbackError(401, "Unauthorized").shouldFallback).toBe(true);
  });

  it("429 rate limit still triggers fallback", () => {
    expect(checkFallbackError(429, "rate limit exceeded").shouldFallback).toBe(true);
  });
});