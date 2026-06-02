import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";

function usageResponse(modelRemains) {
  return new Response(
    JSON.stringify({
      base_resp: { status_code: 0, status_msg: "success" },
      model_remains: modelRemains,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

describe("MiniMax usage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses token-plan TTS quota counts as used counts", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      usageResponse([
        {
          model_name: "text to speech hd",
          current_interval_total_count: 4000,
          current_interval_usage_count: 25,
          current_weekly_total_count: 12000,
          current_weekly_usage_count: 100,
          end_time: "2026-05-12T10:00:00.000Z",
          weekly_end_time: "2026-05-19T10:00:00.000Z",
        },
      ])
    );

    const usage = await getUsageForProvider({
      provider: "minimax",
      apiKey: "test-key",
    });

    expect(usage.message).toBeUndefined();
    expect(usage.quotas["Text to Speech HD (5h)"]).toMatchObject({
      used: 25,
      total: 4000,
      remaining: 3975,
    });
    expect(usage.quotas["Text to Speech HD (7d)"]).toMatchObject({
      used: 100,
      total: 12000,
      remaining: 11900,
    });
  });

  it("parses coding-plan TTS quota counts as remaining counts", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      usageResponse([
        {
          modelName: "Text to Speech HD",
          currentIntervalTotalCount: 4000,
          currentIntervalUsageCount: 4000,
          currentWeeklyTotalCount: 12000,
          currentWeeklyUsageCount: 11800,
          remainsTime: 1000,
          weeklyRemainsTime: 2000,
        },
      ])
    );

    const usage = await getUsageForProvider({
      provider: "minimax-cn",
      apiKey: "test-key",
    });

    expect(usage.message).toBeUndefined();
    expect(usage.quotas["Text to Speech HD (5h)"]).toMatchObject({
      used: 0,
      total: 4000,
      remaining: 4000,
    });
    expect(usage.quotas["Text to Speech HD (7d)"]).toMatchObject({
      used: 200,
      total: 12000,
      remaining: 11800,
    });
  });

  it("keeps non-TTS MiniMax quota rows instead of filtering to text only", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      usageResponse([
        {
          model_name: "music-2.6",
          current_interval_total_count: 100,
          current_interval_usage_count: 5,
        },
        {
          model_name: "image-01",
          current_interval_total_count: 50,
          current_interval_usage_count: 2,
        },
      ])
    );

    const usage = await getUsageForProvider({
      provider: "minimax",
      apiKey: "test-key",
    });

    expect(Object.keys(usage.quotas)).toEqual(["Music 2.6 (5h)", "Image 01 (5h)"]);
    expect(usage.quotas["Music 2.6 (5h)"].used).toBe(5);
    expect(usage.quotas["Image 01 (5h)"].used).toBe(2);
  });

  it("includes M-series percent-only buckets that have no count totals", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      usageResponse([
        {
          model_name: "general",
          current_interval_remaining_percent: 70,
          current_weekly_remaining_percent: 64,
        },
      ])
    );

    const usage = await getUsageForProvider({
      provider: "minimax",
      apiKey: "test-key",
    });

    expect(usage.message).toBeUndefined();
    expect(usage.quotas["M-series (5h)"]).toMatchObject({
      used: 30,
      total: 100,
      remaining: 70,
      remainingPercentage: 70,
    });
    expect(usage.quotas["M-series (7d)"]).toMatchObject({
      used: 36,
      total: 100,
      remaining: 64,
      remainingPercentage: 64,
    });
  });

  it("normalizes M-series percent-only buckets on the coding_plan (countMeansRemaining) endpoint too", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      usageResponse([
        {
          model_name: "general",
          current_interval_remaining_percent: 80,
          current_weekly_remaining_percent: 95,
        },
      ])
    );

    const usage = await getUsageForProvider({
      provider: "minimax-cn",
      apiKey: "test-key",
    });

    expect(usage.message).toBeUndefined();
    expect(usage.quotas["M-series (5h)"]).toMatchObject({
      used: 20,
      total: 100,
      remaining: 80,
      remainingPercentage: 80,
    });
    expect(usage.quotas["M-series (7d)"]).toMatchObject({
      used: 5,
      total: 100,
      remaining: 95,
      remainingPercentage: 95,
    });
  });

  it("renders the M3-era MiniMax-M* wildcard as a friendly series label", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      usageResponse([
        {
          modelName: "MiniMax-M*",
          currentIntervalTotalCount: 4000,
          currentIntervalUsageCount: 3200,
          currentWeeklyTotalCount: 24000,
          currentWeeklyUsageCount: 18000,
          remainsTime: 1000,
          weeklyRemainsTime: 2000,
        },
      ])
    );

    const usage = await getUsageForProvider({
      provider: "minimax-cn",
      apiKey: "test-key",
    });

    expect(usage.message).toBeUndefined();
    expect(Object.keys(usage.quotas)).toEqual([
      "M-series (5h)",
      "M-series (7d)",
    ]);
    expect(usage.quotas["M-series (5h)"]).toMatchObject({
      used: 800,
      total: 4000,
      remaining: 3200,
    });
    expect(usage.quotas["M-series (7d)"]).toMatchObject({
      used: 6000,
      total: 24000,
      remaining: 18000,
    });
  });

  it("prefers the upstream-provided remaining percent when counts are also present", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      usageResponse([
        {
          model_name: "general",
          current_interval_total_count: 4000,
          current_interval_usage_count: 100,
          current_interval_remaining_percent: 84,
          current_weekly_total_count: 24000,
          current_weekly_usage_count: 500,
          current_weekly_remaining_percent: 42,
        },
      ])
    );

    const usage = await getUsageForProvider({
      provider: "minimax",
      apiKey: "test-key",
    });

    expect(usage.quotas["M-series (5h)"].remainingPercentage).toBe(84);
    expect(usage.quotas["M-series (7d)"].remainingPercentage).toBe(42);
  });
});
