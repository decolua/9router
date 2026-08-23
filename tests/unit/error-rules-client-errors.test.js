import { describe, expect, it } from "vitest";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
import { TRANSIENT_COOLDOWN_MS } from "../../open-sse/config/errorConfig.js";

const MIN = 60 * 1000;
const LONG = 2 * MIN;
const FORBIDDEN = 30 * MIN;
const REGION = 24 * 60 * MIN;

// Regression for the 2026-08-23 Yggdrasil exhaustion. One cascade walked all 18
// in-band entries and all 11 deferred ones; eleven of the fifteen real attempts
// were deterministic client errors (400/410), each of which had no status rule
// and so inherited the 30s transient default and returned on the next request.
describe("deterministic client errors are not transient", () => {
  it("400 gets the malformed-request cooldown, not the transient default", () => {
    const { shouldFallback, cooldownMs } = checkFallbackError(400, "Bad request");
    expect(shouldFallback).toBe(true);
    expect(cooldownMs).toBe(LONG);
    expect(cooldownMs).not.toBe(TRANSIENT_COOLDOWN_MS);
  });

  it("400 by status agrees with the 'improperly formed request' text rule", () => {
    expect(checkFallbackError(400, "Bad request").cooldownMs)
      .toBe(checkFallbackError(200, "improperly formed request").cooldownMs);
  });

  it("406 and 410 are treated as not-served-here, like a region block", () => {
    expect(checkFallbackError(406, "Model not supported").cooldownMs).toBe(REGION);
    expect(checkFallbackError(410, "Gone").cooldownMs).toBe(REGION);
  });

  it("still falls back rather than surfacing the error to the client", () => {
    for (const status of [400, 406, 410]) {
      expect(checkFallbackError(status, "").shouldFallback).toBe(true);
    }
  });
});

describe("existing classifications are unchanged", () => {
  it("403 keeps the forbidden cooldown", () => {
    expect(checkFallbackError(403, "Forbidden").cooldownMs).toBe(FORBIDDEN);
  });

  // Raised from COOLDOWN.long 2026-08-23: model_not_found is registry drift that
  // needs an operator, so a two-minute retry is a treadmill, not self-healing.
  it("404 is treated as needing an operator, not as congestion", () => {
    expect(checkFallbackError(404, "Model not found").cooldownMs).toBe(FORBIDDEN);
    expect(checkFallbackError(404, "Model not found").cooldownMs).not.toBe(LONG);
  });

  it("429 still uses exponential backoff, not a fixed cooldown", () => {
    const r = checkFallbackError(429, "Rate limit exceeded", 0);
    expect(r.newBackoffLevel).toBe(1);
    expect(r.cooldownMs).toBeGreaterThan(0);
  });

  it("an unmatched status still gets the transient default", () => {
    expect(checkFallbackError(418, "I'm a teapot").cooldownMs).toBe(TRANSIENT_COOLDOWN_MS);
  });

  it("text rules still outrank status rules", () => {
    // A 400 carrying a region block must not inherit the new 400 rule.
    expect(checkFallbackError(400, "RegionError: not available here").cooldownMs).toBe(REGION);
  });
});
