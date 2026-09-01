import { describe, expect, it } from "vitest";

import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

describe("account fallback classification", () => {
  it("does not lock an account for a generic request-specific 400", () => {
    expect(checkFallbackError(400, '{"error":{"message":"Bad Request"}}')).toEqual({
      shouldFallback: false,
      cooldownMs: 0,
    });
  });

  it("keeps explicit 400 fallback rules", () => {
    expect(checkFallbackError(400, "Request not allowed")).toEqual({
      shouldFallback: true,
      cooldownMs: 5000,
    });
  });

  it("keeps rate-limit fallback classification", () => {
    expect(checkFallbackError(429, "Too many requests", 0)).toEqual({
      shouldFallback: true,
      cooldownMs: 2000,
      newBackoffLevel: 1,
    });
  });

  it("uses a short cooldown for Cloudflare 524 timeouts", () => {
    expect(checkFallbackError(524, "A timeout occurred")).toEqual({
      shouldFallback: true,
      cooldownMs: 2000,
    });
  });

  it("keeps the default cooldown for other transient errors", () => {
    expect(checkFallbackError(502, "Bad gateway")).toEqual({
      shouldFallback: true,
      cooldownMs: 30000,
    });
  });
});
