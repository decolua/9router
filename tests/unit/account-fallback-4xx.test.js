// Regression: an unmatched 4xx (a request-scoped failure) used to hit the
// transient-cooldown default, which locked the account for 30s and — with a
// single connection — answered every other request in that window with a copy of
// the first error. A 400 "maximum context length" from one session therefore
// looked like the same failure in unrelated sessions.
import { describe, expect, it } from "vitest";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

describe("checkFallbackError — request-scoped vs account-scoped failures", () => {
  it("does not cool the account down for a 400 caused by the request", () => {
    const result = checkFallbackError(400, JSON.stringify({
      error: {
        message: "This model's maximum context length is 1048576 tokens. However, you requested 1186139 tokens",
        type: "invalid_request_error",
      },
    }));

    expect(result).toEqual({ shouldFallback: false, cooldownMs: 0 });
  });

  it("still falls back for account-scoped statuses", () => {
    for (const status of [401, 402, 403, 404, 429]) {
      expect(checkFallbackError(status, "nope").shouldFallback).toBe(true);
    }
  });

  it("still honours rate-limit / quota wording on any 4xx", () => {
    expect(checkFallbackError(400, "rate limit reached").shouldFallback).toBe(true);
    expect(checkFallbackError(422, "quota exceeded").shouldFallback).toBe(true);
  });

  // Credit exhaustion on a POOLED credential is account-scoped: the account
  // cannot fund the request, but a sibling account in the pool can. Providers
  // that surface it as HTTP 400 (b.ai, new-api family) must rotate, not abort.
  it("falls back for per-key credit exhaustion on 400", () => {
    expect(checkFallbackError(400, JSON.stringify({
      error: {
        message: "credit insufficient balance: balance=70953 required=433802",
        type: "api_error",
        code: "insufficient_user_quota",
      },
    })).shouldFallback).toBe(true);

    expect(checkFallbackError(400, "insufficient_user_quota").shouldFallback).toBe(true);
    expect(checkFallbackError(400, "run out of funds").shouldFallback).toBe(true);
    // Anthropic OAuth Pro/Max overage bucket depleted arrives as HTTP 400 too.
    expect(checkFallbackError(400, "You are out of extra usage").shouldFallback).toBe(true);
  });

  it("keeps the transient cooldown for unmatched server errors", () => {
    const result = checkFallbackError(503, "upstream exploded");

    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBeGreaterThan(0);
  });
});
