import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("CodeBuddy usage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches quota with IDE access token and saved identity headers", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({
      data: {
        Response: {
          Data: {
            Accounts: [
              {
                PackageCode: "TCACA_code_001_PqouKr6QWV",
                CycleCapacitySize: 100,
                CycleCapacityRemain: 80,
                CapacityUsed: 20,
              },
            ],
          },
        },
      },
    }));

    const usage = await getUsageForProvider({
      provider: "codebuddy",
      accessToken: "ide-access-token",
      providerSpecificData: {
        uid: "uid-1",
        enterpriseId: "enterprise-1",
      },
    });

    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    expect(proxyAwareFetch.mock.calls[0][0]).toBe("https://www.codebuddy.ai/v2/billing/meter/get-user-resource");
    expect(proxyAwareFetch.mock.calls[0][1].headers.Authorization).toBe("Bearer ide-access-token");
    expect(proxyAwareFetch.mock.calls[0][1].headers["X-User-Id"]).toBe("uid-1");
    expect(proxyAwareFetch.mock.calls[0][1].headers["X-Enterprise-Id"]).toBe("enterprise-1");
    expect(JSON.parse(proxyAwareFetch.mock.calls[0][1].body).PackageCodes).toBeUndefined();
    expect(usage.authMode).toBe("oauth");
    expect(usage.quotas["Monthly Credits"]).toMatchObject({
      used: 20,
      total: 100,
      remaining: 80,
    });
  });

  it("reports chat key active instead of access-token missing for apiKey-only connections", async () => {
    const usage = await getUsageForProvider({
      provider: "codebuddy",
      apiKey: "cb-key",
      providerSpecificData: {
        authMode: "generated-api-key",
      },
    });

    expect(proxyAwareFetch).not.toHaveBeenCalled();
    expect(usage.plan).toBe("CodeBuddy");
    expect(usage.message).toContain("chat key active");
    expect(usage.message).toContain("Upstream quota is unavailable");
    expect(usage.message).toContain("9router Usage");
    expect(usage.trackingMode).toBe("local-router");
    expect(usage.quotas).toEqual({});
  });

  it("fetches quota with a saved cookie for generated-key connections", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({
      Response: {
        Data: {
          Accounts: [
            {
              PackageCode: "TCACA_code_001_PqouKr6QWV",
              CycleCapacitySize: 100,
              CycleCapacityRemain: 75,
              CapacityUsed: 25,
            },
          ],
        },
      },
    }));

    const usage = await getUsageForProvider({
      provider: "codebuddy",
      apiKey: "cb-key",
      providerSpecificData: {
        webCookie: "session=abc",
        authMode: "generated-api-key",
      },
    });

    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    expect(proxyAwareFetch.mock.calls[0][0]).toBe("https://www.codebuddy.ai/billing/meter/get-user-resource");
    expect(proxyAwareFetch.mock.calls[0][1].headers.Cookie).toBe("session=abc");
    expect(JSON.parse(proxyAwareFetch.mock.calls[0][1].body).PackageCodes).toContain("TCACA_code_001_PqouKr6QWV");
    expect(usage.authMode).toBe("generated-api-key+web-cookie");
    expect(usage.trackingMode).toBe("upstream-cookie");
    expect(usage.quotas["Monthly Credits"]).toMatchObject({
      used: 25,
      total: 100,
      remaining: 75,
    });
  });

  it("falls back to saved cookie when the IDE OAuth quota response has no records", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({
        data: {
          Response: {
            Data: {
              Accounts: [],
            },
          },
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        Response: {
          Data: {
            Accounts: [
              {
                PackageCode: "TCACA_code_002_AkiJS3ZHF5",
                CycleCapacitySize: 200,
                CycleCapacityRemain: 150,
                CapacityUsed: 50,
              },
            ],
          },
        },
      }));

    const usage = await getUsageForProvider({
      provider: "codebuddy",
      accessToken: "ide-access-token",
      providerSpecificData: {
        uid: "uid-1",
        enterpriseId: "enterprise-1",
        webCookie: "session=abc",
      },
    });

    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
    expect(proxyAwareFetch.mock.calls[1][0]).toBe("https://www.codebuddy.ai/billing/meter/get-user-resource");
    expect(usage.authMode).toBe("oauth+web-cookie");
    expect(usage.trackingMode).toBe("upstream-cookie");
    expect(usage.plan).toBe("Pro");
    expect(usage.quotas["Monthly Credits"]).toMatchObject({
      used: 50,
      total: 200,
      remaining: 150,
    });
  });

  it("falls back to saved cookie when the IDE OAuth token is rejected", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({ message: "unauthorized" }, 401))
      .mockResolvedValueOnce(jsonResponse({
        Response: {
          Data: {
            Accounts: [
              {
                PackageCode: "TCACA_code_001_PqouKr6QWV",
                CycleCapacitySize: 100,
                CycleCapacityRemain: 90,
                CapacityUsed: 10,
              },
            ],
          },
        },
      }));

    const usage = await getUsageForProvider({
      provider: "codebuddy",
      accessToken: "rejected-token",
      apiKey: "cb-key",
      providerSpecificData: {
        uid: "uid-1",
        enterpriseId: "enterprise-1",
        webCookie: "session=expired",
        authMode: "generated-api-key",
      },
    });

    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
    expect(usage.authMode).toBe("oauth-rejected+web-cookie");
    expect(usage.trackingMode).toBe("upstream-cookie");
    expect(usage.quotas["Monthly Credits"]).toMatchObject({
      used: 10,
      total: 100,
      remaining: 90,
    });
  });
});
