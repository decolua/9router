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

describe("GLM Coding Plan usage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses per-model token balances from billing/balance", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            plans: [{ name: "ZCode Start Plan", description: "Trial", starts_at: 1700000000, ends_at: 1800000000 }],
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            balances: [
              {
                show_name: "GLM-5.2",
                total_units: 3000000,
                used_units: 223000,
                remaining_units: 2777000,
                expires_at: 1781625599,
              },
              {
                show_name: "GLM-5-Turbo",
                total_units: 2000000,
                used_units: 0,
                remaining_units: 2000000,
                expires_at: 1781625599,
              },
            ],
          },
        })
      );

    const usage = await getUsageForProvider({
      provider: "glm",
      authType: "oauth",
      accessToken: "jwt-token",
      providerSpecificData: {
        authMethod: "zcode_oauth",
        useCodingPlan: true,
        zcodeJwtToken: "jwt-token",
      },
    });

    expect(usage.plan).toBe("ZCode Start Plan");
    expect(usage.quotas["GLM-5.2"]).toMatchObject({
      used: 223000,
      total: 3000000,
      remainingPercentage: 93,
      unit: "token",
    });
    expect(usage.quotas["GLM-5-Turbo"]).toMatchObject({
      used: 0,
      total: 2000000,
      remainingPercentage: 100,
      unit: "token",
    });
    expect(usage.quotas["GLM-5.2"].resetAt).toBe("2026-06-16T15:59:59.000Z");
  });

  it("returns auth message when billing/current is unauthorized", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({ message: "unauthorized" }, 401))
      .mockResolvedValueOnce(jsonResponse({ data: { balances: [] } }));

    const usage = await getUsageForProvider({
      provider: "glm",
      accessToken: "bad-jwt",
      providerSpecificData: { useCodingPlan: true, zcodeJwtToken: "bad-jwt" },
    });

    expect(usage.message).toMatch(/invalid or expired/i);
    expect(usage.quotas).toBeUndefined();
  });
});