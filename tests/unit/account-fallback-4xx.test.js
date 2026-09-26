// Regression: an unmatched 4xx (a request-scoped failure) used to hit the
// transient-cooldown default, which locked the account for 30s and — with a
// single connection — answered every other request in that window with a copy of
// the first error. A 400 "maximum context length" from one session therefore
// looked like the same failure in unrelated sessions.
// Second regression: the fix opted out "any 4xx that matched no rule", which also
// caught account-scoped statuses — a Fireworks 412 "account is suspended" was
// returned to the client instead of rotating to the provider's next connection.
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

  it("hands back only the request-scoped statuses", () => {
    for (const status of [400, 405, 406, 413, 414, 415, 422]) {
      expect(checkFallbackError(status, "malformed request").shouldFallback).toBe(false);
    }
  });

  it("still falls back for account-scoped statuses", () => {
    for (const status of [401, 402, 403, 404, 429]) {
      expect(checkFallbackError(status, "nope").shouldFallback).toBe(true);
    }
  });

  it("falls back for a 412 account suspension instead of handing it back", () => {
    const result = checkFallbackError(412, JSON.stringify({
      error: {
        message: "Account is suspended. Please check your billing information.",
        type: "invalid_request_error",
      },
    }));

    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBeGreaterThan(0);
  });

  it("falls back for any other unmatched 4xx", () => {
    for (const status of [408, 409, 411, 423, 428, 431, 451]) {
      expect(checkFallbackError(status, "upstream refused").shouldFallback).toBe(true);
    }
  });

  it("still honours rate-limit / quota wording on any 4xx", () => {
    expect(checkFallbackError(400, "rate limit reached").shouldFallback).toBe(true);
    expect(checkFallbackError(422, "quota exceeded").shouldFallback).toBe(true);
  });

  it("keeps the transient cooldown for unmatched server errors", () => {
    const result = checkFallbackError(503, "upstream exploded");

    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBeGreaterThan(0);
  });
});
