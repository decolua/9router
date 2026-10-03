import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDailyConnectionUsage: vi.fn(),
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
  getUsageForProvider: vi.fn(),
  getExecutor: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
}));

vi.mock("open-sse/index.js", () => ({}));

vi.mock("@/lib/localDb", () => ({
  getDailyConnectionUsage: mocks.getDailyConnectionUsage,
  getProviderConnectionById: mocks.getProviderConnectionById,
  updateProviderConnection: mocks.updateProviderConnection,
}));

vi.mock("open-sse/services/usage.js", () => ({
  getUsageForProvider: mocks.getUsageForProvider,
}));

vi.mock("open-sse/executors/index.js", () => ({
  getExecutor: mocks.getExecutor,
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
}));

describe("Grok daily usage route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.resolveConnectionProxyConfig.mockResolvedValue({});
    mocks.getExecutor.mockReturnValue({
      needsRefresh: () => false,
      refreshCredentials: vi.fn(),
    });
  });

  it("replaces the no-numeric-quota text with today's request meter", async () => {
    const connection = {
      id: "grok-1",
      provider: "grok-cli",
      authType: "oauth",
      accessToken: "token",
      providerSpecificData: {},
    };
    mocks.getProviderConnectionById.mockResolvedValue(connection);
    mocks.getUsageForProvider.mockResolvedValue({
      plan: "XPremiumPlus",
      message:
        "Subscription access is active; Grok does not expose a numeric included quota.",
      quotas: {},
    });
    mocks.getDailyConnectionUsage.mockResolvedValue({
      requests: 37,
      tokens: 123456,
      resetAt: "2026-07-21T00:00:00.000Z",
    });

    const { GET } = await import(
      "../../src/app/api/usage/[connectionId]/route.js"
    );
    const response = await GET(
      new Request("http://localhost/api/usage/grok-1"),
      { params: Promise.resolve({ connectionId: "grok-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.getDailyConnectionUsage).toHaveBeenCalledWith("grok-1");
    expect(body.message).toBeUndefined();
    expect(body.quotas["Daily use"]).toMatchObject({
      used: 37,
      total: 800,
      resetAt: "2026-07-21T00:00:00.000Z",
      unlimited: false,
    });
    expect(body.quotas["Daily use"].remainingPercentage).toBeCloseTo(95.375);
  });

  it("preserves owner text when Grok does not report subscribed access", async () => {
    const connection = {
      id: "grok-2",
      provider: "grok-cli",
      authType: "oauth",
      accessToken: "token",
      providerSpecificData: {},
    };
    const usage = {
      plan: "Grok Build",
      message:
        "Grok Build connected, but no credit allotment was returned. Free promo may be exhausted.",
      quotas: {},
    };
    mocks.getProviderConnectionById.mockResolvedValue(connection);
    mocks.getUsageForProvider.mockResolvedValue(usage);

    const { GET } = await import(
      "../../src/app/api/usage/[connectionId]/route.js"
    );
    const response = await GET(
      new Request("http://localhost/api/usage/grok-2"),
      { params: Promise.resolve({ connectionId: "grok-2" }) },
    );

    expect(await response.json()).toEqual(usage);
    expect(mocks.getDailyConnectionUsage).not.toHaveBeenCalled();
  });
});
