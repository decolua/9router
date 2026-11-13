import { describe, expect, it, vi } from "vitest";

const fetch = vi.hoisted(() => vi.fn(async (url) => ({
  ok: true,
  status: 200,
  json: async () => url.includes(":loadCodeAssist")
    ? { cloudaicompanionProject: "project-1", currentTier: { name: "Pro" }, paidTier: { id: "g1-pro-tier" } }
    : { models: {
        "gemini-4-hydrogen-low": { quotaInfo: { remainingFraction: 0.8, resetTime: "2026-11-15T00:00:00Z" } },
        "gemini-4-hydrogen-medium": { quotaInfo: { remainingFraction: 0.6, resetTime: "2026-11-15T00:00:00Z" } },
        "gemini-4-hydrogen-high": { quotaInfo: { remainingFraction: 0, resetTime: "2026-11-15T00:00:00Z" } },
        "gemini-4-hydrogen-xhigh": { quotaInfo: { remainingFraction: 0.2, resetTime: "2026-11-15T00:00:00Z" } },
      } },
  text: async () => "{}",
})));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: fetch }));

describe("Antigravity Hydrogen quotas", () => {
  it("keeps each paid-account tier's quota available to the routing cache", async () => {
    const { getAntigravityUsage } = await import("../../open-sse/services/usage/google.js");
    const usage = await getAntigravityUsage("test-token", {});
    for (const [tier, remaining] of [["low", 80], ["medium", 60], ["high", 0], ["xhigh", 20]]) {
      expect(usage.quotas[`gemini-4-hydrogen-${tier}`]).toMatchObject({
        remainingPercentage: remaining,
        total: 1000,
      });
    }
  });
});
