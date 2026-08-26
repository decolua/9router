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
  // Amended 2026-08-26. The 2026-08-23 finding above still stands — a 400 is not
  // congestion and must not come back on the next request — but the cooldown was
  // aimed at the wrong subject. It was written against the ACCOUNT, so one
  // client's bad payload withdrew a healthy model from every other session
  // sharing that account. The cure is scope, not duration: fall back, lock
  // nothing. The original regression is still guarded, because a request-scoped
  // verdict is not the transient default either — it is no cooldown at all.
  it("400 is scoped to the request: falls back, writes no cooldown", () => {
    const { shouldFallback, cooldownMs, requestScoped } = checkFallbackError(400, "Bad request");
    expect(shouldFallback).toBe(true);
    expect(requestScoped).toBe(true);
    expect(cooldownMs).toBe(0);
    expect(cooldownMs).not.toBe(TRANSIENT_COOLDOWN_MS);
  });

  it("the payload that caused the 2026-08-26 ox-alpha lockout is request-scoped", () => {
    // Verbatim from the router log: openrouter's Stealth upstream rejecting one
    // oversized session 33 times, each rejection locking both accounts for 120s.
    const stealth400 =
      '{"error":{"message":"Provider returned error","code":400,' +
      '"metadata":{"raw":"ERROR","provider_name":"Stealth","is_byok":false}}}';
    expect(checkFallbackError(400, stealth400).requestScoped).toBe(true);
    expect(checkFallbackError(400, stealth400).cooldownMs).toBe(0);

    // Same shape, different provider: antigravity rejecting the prompt on size.
    // Two accounts sat locked for hours on this, which is a request property.
    const oversized = "The input token count exceeds the maximum number of tokens allowed";
    expect(checkFallbackError(400, oversized).requestScoped).toBe(true);
  });

  // These two used to be asserted equal. They are deliberately different now:
  // one names a defect in what the provider accepts, the other names a defect in
  // what this caller sent.
  it("a provider-side 400 still locks; a bare status 400 does not", () => {
    expect(checkFallbackError(200, "improperly formed request").cooldownMs).toBe(LONG);
    expect(checkFallbackError(200, "improperly formed request").requestScoped).toBeUndefined();
    expect(checkFallbackError(400, "Bad request").cooldownMs).toBe(0);
  });

  // The account-scoped 400 that must survive the change. `disciplineLock`
  // synthesises a 400 when a model crosses the malformed-OUTPUT strike
  // threshold — the request was fine, the model was not — and locking is the
  // entire point of that feature.
  it("malformed model output still locks the account", () => {
    const r = checkFallbackError(400, "Malformed model output: doubled-json");
    expect(r.requestScoped).toBeUndefined();
    expect(r.cooldownMs).toBe(LONG);
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
