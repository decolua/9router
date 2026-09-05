import { describe, expect, it, vi, beforeEach } from "vitest";

const { proxyAwareFetch } = vi.hoisted(() => ({
  proxyAwareFetch: vi.fn(),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch,
}));

describe("Antigravity Usage: Weekly Quota Integration & Fail-Open", () => {
  beforeEach(() => {
    proxyAwareFetch.mockReset();
  });

  it("merges existing per-model quotas with weekly family quotas when summary RPC succeeds", async () => {
    const { getAntigravityUsage } = await import("../../open-sse/services/usage/google.js");

    proxyAwareFetch.mockImplementation(async (url) => {
      if (url.includes(":loadCodeAssist")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            cloudaicompanionProject: "test-project-123",
            currentTier: { name: "Pro" },
          }),
        };
      }
      if (url.includes(":fetchAvailableModels")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            models: {
              "gemini-3.8-flash-high": {
                displayName: "Gemini 3.8 Flash (High)",
                quotaInfo: { remainingFraction: 0.85, resetTime: "2026-09-04T00:00:00Z" },
              },
              "claude-opus-4-6-thinking": {
                displayName: "Claude Opus 4.6 (Thinking)",
                quotaInfo: { remainingFraction: 0.5, resetTime: "2026-09-04T00:00:00Z" },
              },
            },
          }),
        };
      }
      if (url.includes(":retrieveUserQuotaSummary")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            groups: [
              {
                displayName: "Gemini Models",
                buckets: [
                  {
                    bucketId: "gemini-weekly",
                    displayName: "Weekly Limit Remaining",
                    window: "weekly",
                    remainingFraction: 0.98583066,
                    resetTime: "2026-09-10T15:50:40Z",
                  },
                ],
              },
              {
                displayName: "Claude and GPT models",
                buckets: [
                  {
                    bucketId: "3p-weekly",
                    displayName: "Weekly Limit Remaining",
                    window: "weekly",
                    remainingFraction: 0,
                    resetTime: "2026-09-06T17:02:34Z",
                  },
                ],
              },
            ],
          }),
        };
      }
      return { ok: false, status: 404 };
    });

    const usage = await getAntigravityUsage("test-access-token", {});

    expect(usage.plan).toBe("Pro");

    // Existing per-model quotas are preserved
    expect(usage.quotas["gemini-3.8-flash-high"]).toMatchObject({
      used: 150,
      total: 1000,
      remainingPercentage: 85,
      displayName: "Gemini 3.8 Flash (High)",
    });
    expect(usage.quotas["claude-opus-4-6-thinking"]).toMatchObject({
      used: 500,
      total: 1000,
      remainingPercentage: 50,
      displayName: "Claude Opus 4.6 (Thinking)",
    });

    // Weekly quotas are merged
    expect(usage.quotas["gemini_weekly"]).toMatchObject({
      used: 1,
      total: 100,
      displayName: "Gemini Weekly",
      unlimited: false,
    });
    expect(usage.quotas["gemini_weekly"].remainingPercentage).toBeCloseTo(98.583066, 4);

    expect(usage.quotas["claude_gpt_weekly"]).toMatchObject({
      used: 100,
      total: 100,
      remainingPercentage: 0,
      displayName: "Claude & GPT Weekly",
      unlimited: false,
    });
  });

  it("starts consuming fetchAvailableModels body before waiting for weekly quota", async () => {
    const { getAntigravityUsage } = await import("../../open-sse/services/usage/google.js");

    let mainBodyConsumptionStarted = false;
    let weeklyResolvedBeforeMainBodyStarted = false;

    proxyAwareFetch.mockImplementation(async (url) => {
      if (url.includes(":loadCodeAssist")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ cloudaicompanionProject: "test-proj-order" }),
        };
      }
      if (url.includes(":fetchAvailableModels")) {
        return {
          ok: true,
          status: 200,
          json: async () => {
            mainBodyConsumptionStarted = true;
            return {
              models: {
                "gemini-3.8-flash-high": {
                  displayName: "Gemini 3.8 Flash (High)",
                  quotaInfo: { remainingFraction: 0.9, resetTime: "2026-09-04T00:00:00Z" },
                },
              },
            };
          },
        };
      }
      if (url.includes(":retrieveUserQuotaSummary")) {
        // Controlled delay simulating network latency
        await new Promise((resolve) => setTimeout(resolve, 30));
        if (!mainBodyConsumptionStarted) {
          weeklyResolvedBeforeMainBodyStarted = true;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            groups: [
              {
                displayName: "Gemini Models",
                buckets: [
                  {
                    bucketId: "gemini-weekly",
                    displayName: "Weekly Limit Remaining",
                    window: "weekly",
                    remainingFraction: 0.95,
                    resetTime: "2026-09-10T15:50:40Z",
                  },
                ],
              },
            ],
          }),
        };
      }
      return { ok: false, status: 404 };
    });

    const usage = await getAntigravityUsage("test-token-order", {});

    expect(mainBodyConsumptionStarted).toBe(true);
    expect(weeklyResolvedBeforeMainBodyStarted).toBe(false);
    expect(usage.quotas["gemini-3.8-flash-high"]).toBeDefined();
    expect(usage.quotas["gemini_weekly"]).toBeDefined();
  });

  it("prevents stream truncation on large model responses caused by deferred consumption", async () => {
    const { getAntigravityUsage } = await import("../../open-sse/services/usage/google.js");

    let weeklyFinished = false;

    proxyAwareFetch.mockImplementation(async (url) => {
      if (url.includes(":loadCodeAssist")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ cloudaicompanionProject: "test-proj-truncation" }),
        };
      }
      if (url.includes(":fetchAvailableModels")) {
        return {
          ok: true,
          status: 200,
          json: async () => {
            if (weeklyFinished) {
              throw new SyntaxError("Unexpected token 'v', \"very code \"... is not valid JSON");
            }
            return {
              models: {
                "gemini-3.8-flash-high": {
                  displayName: "Gemini 3.8 Flash (High)",
                  quotaInfo: { remainingFraction: 0.85, resetTime: "2026-09-04T00:00:00Z" },
                },
              },
            };
          },
        };
      }
      if (url.includes(":retrieveUserQuotaSummary")) {
        await new Promise((resolve) => setTimeout(resolve, 30));
        weeklyFinished = true;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            groups: [
              {
                displayName: "Gemini Models",
                buckets: [
                  {
                    bucketId: "gemini-weekly",
                    displayName: "Weekly Limit Remaining",
                    window: "weekly",
                    remainingFraction: 0.98,
                    resetTime: "2026-09-10T15:50:40Z",
                  },
                ],
              },
            ],
          }),
        };
      }
      return { ok: false, status: 404 };
    });

    const usage = await getAntigravityUsage("test-token-truncation", {});

    expect(usage.message).toBeUndefined();
    expect(usage.quotas["gemini-3.8-flash-high"]).toBeDefined();
    expect(usage.quotas["gemini_weekly"]).toBeDefined();
  });

  it("successfully handles multiple concurrent Antigravity accounts without errors or state cross-talk", async () => {
    const { getAntigravityUsage } = await import("../../open-sse/services/usage/google.js");

    const accountCount = 8;
    const accounts = Array.from({ length: accountCount }, (_, i) => ({
      token: `token-acc-${i + 1}`,
      project: `project-acc-${i + 1}`,
      modelFraction: 0.5 + (i * 0.05),
      weeklyFraction: 0.8 + (i * 0.02),
    }));

    proxyAwareFetch.mockImplementation(async (url, options) => {
      const authHeader = options?.headers?.Authorization || "";
      const token = authHeader.replace("Bearer ", "");
      const acc = accounts.find((a) => a.token === token) || accounts[0];

      if (url.includes(":loadCodeAssist")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ cloudaicompanionProject: acc.project }),
        };
      }
      if (url.includes(":fetchAvailableModels")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            models: {
              "gemini-3.8-flash-high": {
                displayName: "Gemini 3.8 Flash (High)",
                quotaInfo: { remainingFraction: acc.modelFraction, resetTime: "2026-09-04T00:00:00Z" },
              },
            },
          }),
        };
      }
      if (url.includes(":retrieveUserQuotaSummary")) {
        const accIndex = accounts.findIndex((a) => a.token === token);
        const delay = 10 + (accIndex >= 0 ? accIndex * 2 : 0);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            groups: [
              {
                displayName: "Gemini Models",
                buckets: [
                  {
                    bucketId: "gemini-weekly",
                    displayName: "Weekly Limit Remaining",
                    window: "weekly",
                    remainingFraction: acc.weeklyFraction,
                    resetTime: "2026-09-10T15:50:40Z",
                  },
                ],
              },
            ],
          }),
        };
      }
      return { ok: false, status: 404 };
    });

    const results = await Promise.all(
      accounts.map((acc) => getAntigravityUsage(acc.token, {}))
    );

    expect(results).toHaveLength(accountCount);
    results.forEach((res, i) => {
      expect(res.message).toBeUndefined();
      expect(res.quotas["gemini-3.8-flash-high"]).toBeDefined();
      expect(res.quotas["gemini_weekly"]).toBeDefined();
      const expectedModelRemaining = Math.round(1000 * accounts[i].modelFraction);
      expect(res.quotas["gemini-3.8-flash-high"].used).toBe(1000 - expectedModelRemaining);
    });
  });

  it("fails open when retrieveUserQuotaSummary returns 404", async () => {
    const { getAntigravityUsage } = await import("../../open-sse/services/usage/google.js");

    proxyAwareFetch.mockImplementation(async (url) => {
      if (url.includes(":loadCodeAssist")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            cloudaicompanionProject: "test-project-404",
            currentTier: { name: "Pro" },
          }),
        };
      }
      if (url.includes(":fetchAvailableModels")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            models: {
              "gemini-3.8-flash-high": {
                displayName: "Gemini 3.8 Flash (High)",
                quotaInfo: { remainingFraction: 0.85, resetTime: "2026-09-04T00:00:00Z" },
              },
            },
          }),
        };
      }
      if (url.includes(":retrieveUserQuotaSummary")) {
        return {
          ok: false,
          status: 404,
          text: async () => "Not Found",
        };
      }
      return { ok: false, status: 500 };
    });

    const usage = await getAntigravityUsage("test-access-token-404", {});

    expect(usage.quotas["gemini-3.8-flash-high"]).toMatchObject({
      used: 150,
      total: 1000,
      remainingPercentage: 85,
    });
    expect(usage.quotas).not.toHaveProperty("gemini_weekly");
    expect(usage.quotas).not.toHaveProperty("claude_gpt_weekly");
  });

  it("fails open when retrieveUserQuotaSummary returns 429", async () => {
    const { getAntigravityUsage } = await import("../../open-sse/services/usage/google.js");

    proxyAwareFetch.mockImplementation(async (url) => {
      if (url.includes(":loadCodeAssist")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            cloudaicompanionProject: "test-project-429",
            currentTier: { name: "Pro" },
          }),
        };
      }
      if (url.includes(":fetchAvailableModels")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            models: {
              "gemini-3.8-flash-high": {
                displayName: "Gemini 3.8 Flash (High)",
                quotaInfo: { remainingFraction: 0.85, resetTime: "2026-09-04T00:00:00Z" },
              },
            },
          }),
        };
      }
      if (url.includes(":retrieveUserQuotaSummary")) {
        return {
          ok: false,
          status: 429,
          text: async () => "Too Many Requests",
        };
      }
      return { ok: false, status: 500 };
    });

    const usage = await getAntigravityUsage("test-access-token-429", {});

    expect(usage.quotas["gemini-3.8-flash-high"]).toMatchObject({
      used: 150,
      total: 1000,
      remainingPercentage: 85,
    });
    expect(usage.quotas).not.toHaveProperty("gemini_weekly");
    expect(usage.quotas).not.toHaveProperty("claude_gpt_weekly");
  });

  it("fails open when retrieveUserQuotaSummary returns 500", async () => {
    const { getAntigravityUsage } = await import("../../open-sse/services/usage/google.js");

    proxyAwareFetch.mockImplementation(async (url) => {
      if (url.includes(":loadCodeAssist")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            cloudaicompanionProject: "test-project-500",
            currentTier: { name: "Pro" },
          }),
        };
      }
      if (url.includes(":fetchAvailableModels")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            models: {
              "gemini-3.8-flash-high": {
                displayName: "Gemini 3.8 Flash (High)",
                quotaInfo: { remainingFraction: 0.85, resetTime: "2026-09-04T00:00:00Z" },
              },
            },
          }),
        };
      }
      if (url.includes(":retrieveUserQuotaSummary")) {
        return {
          ok: false,
          status: 500,
          text: async () => "Internal Server Error",
        };
      }
      return { ok: false, status: 500 };
    });

    const usage = await getAntigravityUsage("test-access-token-500", {});

    expect(usage.quotas["gemini-3.8-flash-high"]).toMatchObject({
      used: 150,
      total: 1000,
      remainingPercentage: 85,
    });
    expect(usage.quotas).not.toHaveProperty("gemini_weekly");
    expect(usage.quotas).not.toHaveProperty("claude_gpt_weekly");
  });

  it("fails open when retrieveUserQuotaSummary returns malformed JSON", async () => {
    const { getAntigravityUsage } = await import("../../open-sse/services/usage/google.js");

    proxyAwareFetch.mockImplementation(async (url) => {
      if (url.includes(":loadCodeAssist")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            cloudaicompanionProject: "test-project-bad-json",
            currentTier: { name: "Pro" },
          }),
        };
      }
      if (url.includes(":fetchAvailableModels")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            models: {
              "gemini-3.8-flash-high": {
                displayName: "Gemini 3.8 Flash (High)",
                quotaInfo: { remainingFraction: 0.85, resetTime: "2026-09-04T00:00:00Z" },
              },
            },
          }),
        };
      }
      if (url.includes(":retrieveUserQuotaSummary")) {
        return {
          ok: true,
          status: 200,
          json: async () => {
            throw new SyntaxError("Unexpected token in JSON at position 0");
          },
        };
      }
      return { ok: false, status: 500 };
    });

    const usage = await getAntigravityUsage("test-access-token-bad-json", {});

    expect(usage.quotas["gemini-3.8-flash-high"]).toMatchObject({
      used: 150,
      total: 1000,
      remainingPercentage: 85,
    });
    expect(usage.quotas).not.toHaveProperty("gemini_weekly");
    expect(usage.quotas).not.toHaveProperty("claude_gpt_weekly");
  });

  it("fails open when retrieveUserQuotaSummary throws network exception", async () => {
    const { getAntigravityUsage } = await import("../../open-sse/services/usage/google.js");

    proxyAwareFetch.mockImplementation(async (url) => {
      if (url.includes(":loadCodeAssist")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            cloudaicompanionProject: "test-project-net-err",
            currentTier: { name: "Pro" },
          }),
        };
      }
      if (url.includes(":fetchAvailableModels")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            models: {
              "gemini-3.8-flash-high": {
                displayName: "Gemini 3.8 Flash (High)",
                quotaInfo: { remainingFraction: 0.85, resetTime: "2026-09-04T00:00:00Z" },
              },
            },
          }),
        };
      }
      if (url.includes(":retrieveUserQuotaSummary")) {
        throw new Error("DNS resolution failed");
      }
      return { ok: false, status: 500 };
    });

    const usage = await getAntigravityUsage("test-access-token-net-err", {});

    expect(usage.quotas["gemini-3.8-flash-high"]).toBeDefined();
    expect(usage.quotas).not.toHaveProperty("gemini_weekly");
    expect(usage.quotas).not.toHaveProperty("claude_gpt_weekly");
  });
});
