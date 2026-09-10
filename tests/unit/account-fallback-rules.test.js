import { describe, it, expect } from "vitest";

import { checkFallbackError, getQuotaCooldown } from "../../open-sse/services/accountFallback.js";

// checkFallbackError is the single decision point both the per-account loop
// (src/sse/handlers/chat.js) and the per-combo-candidate loop (open-sse/services/combo.js)
// call to decide "try the next account/model" vs "stop and surface this error".
describe("checkFallbackError decision matrix", () => {
  it("429 with no matching text triggers status-based backoff, escalating per attempt", () => {
    const first = checkFallbackError(429, "Too Many Requests", 0);
    expect(first).toEqual({ shouldFallback: true, cooldownMs: getQuotaCooldown(1), newBackoffLevel: 1 });

    const second = checkFallbackError(429, "Too Many Requests", first.newBackoffLevel);
    expect(second).toEqual({ shouldFallback: true, cooldownMs: getQuotaCooldown(2), newBackoffLevel: 2 });
    expect(second.cooldownMs).toBeGreaterThan(first.cooldownMs);
  });

  it("text-based rate-limit phrasing triggers backoff even when the status code doesn't match (e.g. 200 wrapping an error body)", () => {
    const r = checkFallbackError(200, "Rate limit exceeded, please retry later", 0);
    expect(r.shouldFallback).toBe(true);
    expect(r.newBackoffLevel).toBe(1);
  });

  it("text rules are matched before status rules (order = priority)", () => {
    // 401 alone would hit the status-based long cooldown; "quota exceeded" text should win first.
    const r = checkFallbackError(401, "quota exceeded for this key", 0);
    expect(r.shouldFallback).toBe(true);
    expect(r.newBackoffLevel).toBe(1); // backoff path, not the fixed long-cooldown 401 path
  });

  it("401/402/403/404 use a fixed long cooldown, not exponential backoff", () => {
    for (const status of [401, 402, 403, 404]) {
      const r = checkFallbackError(status, "some upstream message", 3);
      expect(r.shouldFallback).toBe(true);
      expect(r.newBackoffLevel).toBeUndefined();
      expect(r.cooldownMs).toBe(2 * 60 * 1000);
    }
  });

  it("falls back to a 30s transient cooldown for unclassified 5xx errors", () => {
    for (const status of [500, 502, 503, 504]) {
      const r = checkFallbackError(status, "upstream had a bad day", 0);
      expect(r).toEqual({ shouldFallback: true, cooldownMs: 30 * 1000 });
    }
  });

  // Documents current behavior rather than asserting a requirement: there is no rule
  // anywhere in this file that ever returns shouldFallback:false. A malformed-request
  // 400 (a client-side bug that will reproduce identically on every other account/model)
  // is classified exactly like a transient 503. See PR description "Findings for
  // maintainer triage" — this is flagged, not fixed, per this PR's test-only scope.
  it("a definitively non-retryable 400 (malformed request) is currently classified the same as a transient error", () => {
    const malformed = checkFallbackError(400, "Invalid schema: 'tool_choice' is not supported for this model", 0);
    const transient503 = checkFallbackError(503, "upstream had a bad day", 0);
    expect(malformed.shouldFallback).toBe(true);
    expect(malformed.cooldownMs).toBe(transient503.cooldownMs);
  });

  it("never returns shouldFallback:false for any status/text combination it classifies", () => {
    const samples = [
      [400, "bad request"], [401, "unauthorized"], [402, "payment required"],
      [403, "forbidden"], [404, "not found"], [429, "too many requests"],
      [500, "server error"], [503, "unavailable"], [200, "quota exceeded"],
    ];
    for (const [status, text] of samples) {
      expect(checkFallbackError(status, text, 0).shouldFallback).toBe(true);
    }
  });

  it("backoff level is capped at BACKOFF_CONFIG.maxLevel (15)", () => {
    const r = checkFallbackError(429, "rate limit", 999);
    expect(r.newBackoffLevel).toBe(15);
  });

  it("getQuotaCooldown is capped at the configured max (5 minutes)", () => {
    expect(getQuotaCooldown(20)).toBe(5 * 60 * 1000);
  });
});
