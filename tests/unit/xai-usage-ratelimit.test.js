import { describe, it, expect } from "vitest";
import { getUsageForProvider } from "../../open-sse/services/usage.js";

describe("xAI usage (passive rate-limit snapshot)", () => {
  it("returns an informational message when no snapshot has been captured yet", async () => {
    const usage = await getUsageForProvider({ provider: "xai", accessToken: "tok" });
    expect(usage.quotas).toBeUndefined();
    expect(usage.message).toMatch(/after the first Grok request/i);
  });

  it("maps a captured snapshot into Requests/Tokens window quotas (used = limit - remaining)", async () => {
    const usage = await getUsageForProvider({
      provider: "xai",
      accessToken: "tok",
      rateLimitSnapshot: {
        capturedAt: "2026-06-05T01:00:00.000Z",
        limitRequests: 480,
        remainingRequests: 475,
        limitTokens: 10_000_000,
        remainingTokens: 9_900_000,
      },
    });

    expect(usage.message).toBeUndefined();
    expect(usage.capturedAt).toBe("2026-06-05T01:00:00.000Z");
    expect(usage.quotas["Rate limit requests (window)"]).toMatchObject({
      total: 480,
      used: 5,
      unit: "requests",
    });
    expect(usage.quotas["Rate limit tokens (window)"]).toMatchObject({
      total: 10_000_000,
      used: 100_000,
      unit: "tokens",
    });
  });

  it("falls back to remaining = total when remaining header is absent", async () => {
    const usage = await getUsageForProvider({
      provider: "xai",
      accessToken: "tok",
      rateLimitSnapshot: { limitRequests: 480, limitTokens: null },
    });

    expect(usage.quotas["Rate limit requests (window)"]).toMatchObject({ total: 480, used: 0 });
    expect(usage.quotas["Rate limit tokens (window)"]).toBeUndefined();
  });
});
