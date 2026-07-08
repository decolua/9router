import { describe, it, expect, vi, beforeEach } from "vitest";

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

describe("Cursor usage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses GetCurrentPeriodUsage with all quota types", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(
        jsonResponse({
          billingCycleEnd: "1771077734000",
          planUsage: {
            includedSpend: 23222,
            limit: 40000,
            autoPercentUsed: 12.5,
            apiPercentUsed: 46.444,
          },
          spendLimitUsage: {
            individualUsed: 500,
            individualLimit: 10000,
            pooledUsed: 0,
            pooledLimit: 50000,
          },
          displayMessage: "You've used 46% of your usage limit",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          planInfo: { planName: "Ultra" },
        }),
      );

    const usage = await getUsageForProvider({
      provider: "cursor",
      accessToken: "test-token",
      providerSpecificData: { machineId: "machine-123" },
    });

    expect(usage.plan).toBe("Ultra");
    expect(usage.quotas["Included spend"]).toMatchObject({
      used: 232.22,
      total: 400,
      remaining: 42,
    });
    expect(usage.quotas["Auto mode"]).toMatchObject({
      used: 12.5,
      total: 100,
      remaining: 87.5,
    });
    expect(usage.quotas["API usage"]).toMatchObject({
      used: 46.444,
      total: 100,
    });
    expect(usage.quotas["On-demand (individual)"]).toMatchObject({
      used: 5,
      total: 100,
    });
    expect(usage.quotas["On-demand (team pool)"]).toMatchObject({
      used: 0,
      total: 500,
    });
  });

  it("omits on-demand rows when limits are zero", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(
        jsonResponse({
          billingCycleEnd: "1771077734000",
          planUsage: {
            includedSpend: 1000,
            limit: 40000,
            autoPercentUsed: 0,
            apiPercentUsed: 10,
          },
          spendLimitUsage: {
            individualUsed: 0,
            individualLimit: 0,
            pooledUsed: 0,
            pooledLimit: 0,
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ planInfo: { planName: "Pro" } }));

    const usage = await getUsageForProvider({
      provider: "cursor",
      accessToken: "test-token",
      providerSpecificData: {},
    });

    expect(usage.quotas["On-demand (individual)"]).toBeUndefined();
    expect(usage.quotas["On-demand (team pool)"]).toBeUndefined();
    expect(usage.quotas["API usage"]).toBeDefined();
  });

  it("falls back to /auth/usage when dashboard returns empty planUsage", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({ billingCycleEnd: "1771077734000", planUsage: {} }))
      .mockResolvedValueOnce(jsonResponse({ planInfo: { planName: "Enterprise" } }))
      .mockResolvedValueOnce(
        jsonResponse({
          startOfMonth: "2026-03-01T00:00:00.000Z",
          "gpt-4": { numRequests: 150, maxRequestUsage: 500 },
        }),
      );

    const usage = await getUsageForProvider({
      provider: "cursor",
      accessToken: "test-token",
      providerSpecificData: {},
    });

    expect(usage.plan).toBe("Enterprise");
    expect(usage.quotas["gpt-4"]).toMatchObject({
      used: 150,
      total: 500,
      remaining: 70,
    });
  });

  it("returns auth message on 401", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({ error: "unauthorized" }, 401));

    const usage = await getUsageForProvider({
      provider: "cursor",
      accessToken: "expired-token",
      providerSpecificData: {},
    });

    expect(usage.message).toMatch(/expired or invalid/i);
    expect(usage.quotas).toBeUndefined();
  });
});
