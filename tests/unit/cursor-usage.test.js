import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";
import { USAGE_SUPPORTED_PROVIDERS } from "../../src/shared/constants/providers.js";
import { parseQuotaData } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

const PERIOD_URL = "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage";
const PLAN_URL = "https://api2.cursor.sh/aiserver.v1.DashboardService/GetPlanInfo";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const PERIOD_USAGE = {
  billingCycleStart: "1768399334000",
  billingCycleEnd: "1771077734000",
  planUsage: {
    totalSpend: 23222,
    includedSpend: 23222,
    bonusSpend: 0,
    remaining: 16778,
    limit: 40000,
    autoPercentUsed: 10,
    apiPercentUsed: 46.444,
    totalPercentUsed: 58.055,
  },
  spendLimitUsage: {
    individualLimit: 10000,
    individualUsed: 2500,
    individualRemaining: 7500,
    limitType: "user",
  },
};

describe("cursor registry usage flags", () => {
  it("is listed for the quota dashboard", () => {
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("cursor");
  });
});

describe("getUsageForProvider(cursor)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("POSTs GetCurrentPeriodUsage with Connect JSON headers", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse(PERIOD_USAGE))
      .mockResolvedValueOnce(jsonResponse({ planInfo: { planName: "Pro+" } }));

    const usage = await getUsageForProvider({
      provider: "cursor",
      accessToken: "cursor-token",
      providerSpecificData: { machineId: "machine-1" },
    });

    expect(usage.message).toBeUndefined();
    expect(usage.plan).toBe("Cursor Pro+");
    expect(proxyAwareFetch.mock.calls[0][0]).toBe(PERIOD_URL);
    expect(proxyAwareFetch.mock.calls[0][1].method).toBe("POST");
    expect(proxyAwareFetch.mock.calls[0][1].body).toBe("{}");
    expect(proxyAwareFetch.mock.calls[0][1].headers["content-type"]).toBe("application/json");
    expect(proxyAwareFetch.mock.calls[0][1].headers.authorization).toMatch(/^Bearer /);
    expect(proxyAwareFetch.mock.calls[1][0]).toBe(PLAN_URL);
  });

  it("maps cents to USD without absolute remaining", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse(PERIOD_USAGE))
      .mockResolvedValueOnce(jsonResponse({ planInfo: { planName: "Ultra" } }));

    const usage = await getUsageForProvider({
      provider: "cursor",
      accessToken: "cursor-token",
    });

    expect(usage.quotas["Plan (USD)"]).toMatchObject({
      used: 232.22,
      total: 400,
      remainingPercentage: expect.closeTo(41.945, 3),
    });
    expect(usage.quotas["Plan (USD)"].remaining).toBeUndefined();
    expect(usage.quotas["On-demand (USD)"]).toMatchObject({
      used: 25,
      total: 100,
      remainingPercentage: 75,
    });
    expect(usage.quotas["Auto models (%)"].used).toBe(10);
    expect(usage.quotas["Named models (%)"].used).toBe(46.444);
  });

  it("falls back to /auth/usage request buckets when plan spend is empty", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({
        "gpt-4": { numRequests: 20, maxRequestUsage: 500 },
        startOfMonth: "2026-06-25T05:42:21.000Z",
      }))
      .mockResolvedValueOnce(jsonResponse({ planInfo: { planName: "Enterprise" } }));

    const usage = await getUsageForProvider({
      provider: "cursor",
      accessToken: "cursor-token",
    });

    expect(usage.quotas["gpt-4 requests"]).toMatchObject({
      used: 20,
      total: 500,
      remainingPercentage: 96,
    });
  });

  it("returns message on missing token / 401", async () => {
    const missing = await getUsageForProvider({ provider: "cursor" });
    expect(missing.message).toMatch(/token/i);
    expect(proxyAwareFetch).not.toHaveBeenCalled();

    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({ error: "no" }, 401));
    const auth = await getUsageForProvider({
      provider: "cursor",
      accessToken: "bad",
    });
    expect(auth.message).toMatch(/auth|reconnect/i);
  });
});

describe("parseQuotaData(cursor)", () => {
  it("forwards remainingPercentage for plan spend rows", () => {
    const rows = parseQuotaData("cursor", {
      plan: "Cursor Pro",
      quotas: {
        "Plan (USD)": {
          used: 10,
          total: 40,
          remainingPercentage: 75,
        },
      },
    });
    expect(rows[0]).toMatchObject({
      name: "Plan (USD)",
      used: 10,
      total: 40,
      remainingPercentage: 75,
    });
  });
});
