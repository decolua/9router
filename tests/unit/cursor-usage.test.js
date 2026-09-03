import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";
import { USAGE_SUPPORTED_PROVIDERS } from "../../src/shared/constants/providers.js";
import { parseQuotaData } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

const USAGE_URL = "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage";
const PLAN_URL = "https://api2.cursor.sh/aiserver.v1.DashboardService/GetPlanInfo";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("cursor registry usage flags", () => {
  it("is listed for the quota dashboard", () => {
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("cursor");
  });
});

describe("getUsageForProvider(cursor)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("POSTs the Connect RPC endpoint with Bearer auth and an empty proto body", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({
        enabled: true,
        billingCycleEnd: 1735689600000,
        planUsage: { limit: 2000, totalSpend: 500, totalPercentUsed: 25 },
      }))
      .mockResolvedValueOnce(jsonResponse({ planInfo: { planName: "pro" } }));

    const usage = await getUsageForProvider({ provider: "cursor", accessToken: "tok" });

    expect(usage.message).toBeUndefined();
    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
    const [url, opts] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe(USAGE_URL);
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe("Bearer tok");
    expect(opts.headers["Connect-Protocol-Version"]).toBe("1");
    expect(opts.body).toBe("{}");
    expect(proxyAwareFetch.mock.calls[1][0]).toBe(PLAN_URL);
  });

  it("maps totalPercentUsed straight through as a percent quota", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({
        enabled: true,
        billingCycleEnd: 1735689600000,
        planUsage: { limit: 2000, totalSpend: 500, totalPercentUsed: 25, autoPercentUsed: 10 },
      }))
      .mockResolvedValueOnce(jsonResponse({ planInfo: { planName: "pro" } }));

    const usage = await getUsageForProvider({ provider: "cursor", accessToken: "tok" });

    expect(usage.plan).toBe("pro");
    expect(usage.quotas["Total usage"]).toMatchObject({ used: 25, total: 100, remaining: 75 });
    expect(usage.quotas["Auto usage"]).toMatchObject({ used: 10, total: 100 });
    expect(usage.quotas["API usage"]).toBeUndefined();
  });

  it("falls back to limit/remaining ratio when totalPercentUsed is missing", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({
        enabled: true,
        planUsage: { limit: 1000, remaining: 750 },
      }))
      .mockResolvedValueOnce(jsonResponse({}, 500));

    const usage = await getUsageForProvider({ provider: "cursor", accessToken: "tok" });

    expect(usage.quotas["Total usage"].used).toBe(25);
    expect(usage.plan).toBe("Cursor"); // optional plan-name lookup failed, non-fatal
  });

  it("returns a message when there's no active subscription or no token", async () => {
    const missing = await getUsageForProvider({ provider: "cursor" });
    expect(missing.message).toMatch(/token/i);
    expect(proxyAwareFetch).not.toHaveBeenCalled();

    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({ enabled: false }));
    const disabled = await getUsageForProvider({ provider: "cursor", accessToken: "tok" });
    expect(disabled.message).toMatch(/subscription/i);
  });

  it("returns a message on non-2xx or invalid JSON", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({}, 401));
    const unauthorized = await getUsageForProvider({ provider: "cursor", accessToken: "bad" });
    expect(unauthorized.message).toMatch(/401/);
  });
});

describe("parseQuotaData(cursor)", () => {
  it("forwards percent quota rows unchanged", () => {
    const rows = parseQuotaData("cursor", {
      plan: "pro",
      quotas: {
        "Total usage": { used: 25, total: 100, resetAt: null },
      },
    });
    expect(rows[0]).toMatchObject({ name: "Total usage", used: 25, total: 100 });
  });
});
