import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getFactoryUsage } from "../../open-sse/services/usage/factory.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";
import { USAGE_SUPPORTED_PROVIDERS } from "../../src/shared/constants/providers.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const SAMPLE_LIMITS_RESPONSE = {
  planType: "pro",
  limits: {
    standard: {
      fiveHour: {
        usedPercent: 42.5,
        windowEnd: "2026-09-05T18:00:00.000Z",
      },
      weekly: {
        usedPercent: 20.0,
        windowEnd: "2026-09-12T00:00:00.000Z",
      },
      monthly: {
        used_percent: 15.0,
        secondsRemaining: 864000,
      },
    },
    core: {
      fiveHour: {
        usedPercent: 80.0,
        windowEnd: "2026-09-05T19:00:00.000Z",
      },
      weekly: {
        usedPercent: 55.0,
        windowEnd: "2026-09-12T00:00:00.000Z",
      },
    },
  },
  extraUsageBalanceCents: 2500,
  extraUsageAllowed: true,
  overagePreference: "allow",
};

describe("Factory Usage Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is recognized as a usage-supported provider in REGISTRY", () => {
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("factory");
  });

  it("returns error if access token is missing", async () => {
    const result = await getFactoryUsage(null);
    expect(result.error).toBe("Missing access token");
  });

  it("fetches and parses limits correctly with standard and core quotas", async () => {
    proxyAwareFetch.mockResolvedValue(jsonResponse(SAMPLE_LIMITS_RESPONSE));

    const result = await getFactoryUsage("factory-access-token-123", { orgId: "org-test-789" });

    expect(proxyAwareFetch).toHaveBeenCalledWith(
      "https://api.factory.ai/api/billing/limits",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer factory-access-token-123",
          "X-Factory-Client": "cli",
          "X-Factory-Org-Id": "org-test-789",
        }),
      }),
      null
    );

    expect(result.plan).toBe("pro");
    expect(result.quotas.standard_5h).toBeDefined();
    expect(result.quotas.standard_5h.used).toBe(42.5);
    expect(result.quotas.standard_5h.remaining).toBe(57.5);
    expect(result.quotas.standard_5h.resetAt).toBe("2026-09-05T18:00:00.000Z");

    expect(result.quotas.standard_weekly.used).toBe(20.0);
    expect(result.quotas.standard_weekly.remaining).toBe(80.0);

    expect(result.quotas.standard_monthly.used).toBe(15.0);
    expect(result.quotas.standard_monthly.remaining).toBe(85.0);

    expect(result.quotas.core_5h.used).toBe(80.0);
    expect(result.quotas.core_5h.remaining).toBe(20.0);

    // Fallbacks for standard dashboard views
    expect(result.quotas.session).toEqual(result.quotas.standard_5h);
    expect(result.quotas.weekly).toEqual(result.quotas.standard_weekly);

    // Extra usage
    expect(result.extraUsage).toEqual({
      balance: 25.0,
      allowed: true,
      overagePreference: "allow",
    });
  });

  it("handles HTTP error gracefully", async () => {
    proxyAwareFetch.mockResolvedValue(new Response("Unauthorized", { status: 401 }));

    const result = await getFactoryUsage("invalid-token");
    expect(result.error).toBe("Factory billing API error: HTTP 401");
  });

  it("handles network failure gracefully", async () => {
    proxyAwareFetch.mockRejectedValue(new Error("Connection refused"));

    const result = await getFactoryUsage("test-token");
    expect(result.error).toBe("Connection refused");
  });

  it("dispatches through getUsageForProvider", async () => {
    proxyAwareFetch.mockResolvedValue(jsonResponse(SAMPLE_LIMITS_RESPONSE));

    const result = await getUsageForProvider({
      provider: "factory",
      accessToken: "token-via-dispatcher",
      providerSpecificData: { orgId: "org-dispatch" },
    });

    expect(result.plan).toBe("pro");
    expect(result.quotas.standard_5h.used).toBe(42.5);
  });
});
