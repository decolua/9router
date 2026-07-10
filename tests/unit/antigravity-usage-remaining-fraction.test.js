import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockAntigravityUsage(models) {
  // 1) loadCodeAssist / subscription
  proxyAwareFetch.mockResolvedValueOnce(
    jsonResponse({
      cloudaicompanionProject: "test-project",
      currentTier: { name: "Free" },
    })
  );
  // 2) fetchAvailableModels / quota
  proxyAwareFetch.mockResolvedValueOnce(
    jsonResponse({
      models,
    })
  );
}

describe("Antigravity usage remainingFraction unknown-safe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("includes models with a reported remainingFraction", async () => {
    mockAntigravityUsage({
      "claude-sonnet-4-6": {
        displayName: "Claude Sonnet 4.6",
        quotaInfo: {
          remainingFraction: 0.8,
          resetTime: "2026-07-10T18:00:00Z",
        },
      },
    });

    const usage = await getUsageForProvider({
      provider: "antigravity",
      accessToken: "token",
    });

    expect(usage.quotas["claude-sonnet-4-6"]).toMatchObject({
      used: 200,
      total: 1000,
      remainingPercentage: 80,
      unlimited: false,
    });
  });

  it("treats remainingFraction 0 as truly exhausted (not unknown)", async () => {
    mockAntigravityUsage({
      "claude-sonnet-4-6": {
        displayName: "Claude Sonnet 4.6",
        quotaInfo: {
          remainingFraction: 0,
          resetTime: "2026-07-10T18:00:00Z",
        },
      },
    });

    const usage = await getUsageForProvider({
      provider: "antigravity",
      accessToken: "token",
    });

    expect(usage.quotas["claude-sonnet-4-6"]).toMatchObject({
      used: 1000,
      total: 1000,
      remainingPercentage: 0,
    });
  });

  it("skips models with missing remainingFraction instead of defaulting to 0%", async () => {
    mockAntigravityUsage({
      "claude-sonnet-4-6": {
        displayName: "Claude Sonnet 4.6",
        quotaInfo: {
          // OmniRoute #6295 / #6502 pattern: catalog can omit remainingFraction
          resetTime: "2026-07-10T18:00:00Z",
        },
      },
      "gpt-oss-120b-medium": {
        displayName: "GPT-OSS 120B",
        quotaInfo: {
          remainingFraction: null,
          resetTime: "2026-07-10T18:00:00Z",
        },
      },
    });

    const usage = await getUsageForProvider({
      provider: "antigravity",
      accessToken: "token",
    });

    expect(usage.quotas["claude-sonnet-4-6"]).toBeUndefined();
    expect(usage.quotas["gpt-oss-120b-medium"]).toBeUndefined();
    // Unknown windows must not pollute quotas as false 0% remaining.
    expect(Object.keys(usage.quotas || {})).toEqual([]);
  });

  it("keeps only reported models when mix of known and unknown fractions", async () => {
    mockAntigravityUsage({
      "claude-sonnet-4-6": {
        displayName: "Claude Sonnet 4.6",
        quotaInfo: {
          remainingFraction: 0.55,
          resetTime: "2026-07-10T18:00:00Z",
        },
      },
      "gpt-oss-120b-medium": {
        displayName: "GPT-OSS 120B",
        quotaInfo: {
          // unreported — must not become remainingPercentage: 0
          resetTime: "2026-07-10T18:00:00Z",
        },
      },
      "gemini-3-flash": {
        displayName: "Gemini 3 Flash",
        isInternal: true,
        quotaInfo: {
          remainingFraction: 0.1,
          resetTime: "2026-07-10T18:00:00Z",
        },
      },
    });

    const usage = await getUsageForProvider({
      provider: "antigravity",
      accessToken: "token",
    });

    expect(Object.keys(usage.quotas)).toEqual(["claude-sonnet-4-6"]);
    expect(usage.quotas["claude-sonnet-4-6"].used).toBe(450);
    expect(usage.quotas["claude-sonnet-4-6"].total).toBe(1000);
    // 0.55 * 100 can be 55.00000000000001 in IEEE floats — compare with tolerance
    expect(usage.quotas["claude-sonnet-4-6"].remainingPercentage).toBeCloseTo(55, 10);
    expect(usage.quotas["gpt-oss-120b-medium"]).toBeUndefined();
    expect(usage.quotas["gemini-3-flash"]).toBeUndefined(); // internal filtered
  });
});
