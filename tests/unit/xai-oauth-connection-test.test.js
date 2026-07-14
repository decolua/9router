import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  testProxyUrl: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
  updateProviderConnection: mocks.updateProviderConnection,
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
}));

vi.mock("@/lib/network/proxyTest", () => ({
  testProxyUrl: mocks.testProxyUrl,
}));

const { testSingleConnection } = await import("../../src/app/api/providers/[id]/test/testUtils.js");

const xaiConnection = {
  id: "conn-xai",
  provider: "xai",
  authType: "oauth",
  accessToken: "old-access-token",
  refreshToken: "refresh-token",
  expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  providerSpecificData: {},
};

describe("xai OAuth connection test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderConnectionById.mockResolvedValue({ ...xaiConnection });
    mocks.resolveConnectionProxyConfig.mockResolvedValue({});
  });

  it("probes the xAI models endpoint for Grok Build OAuth accounts", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    const result = await testSingleConnection("conn-xai");

    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.x.ai/v1/models",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer old-access-token" }),
      })
    );
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith(
      "conn-xai",
      expect.objectContaining({ testStatus: "active", lastError: null })
    );
  });

  it("refreshes an expired or rejected xAI OAuth token and persists the new token", async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          access_token: "new-access-token",
          refresh_token: "new-refresh-token",
          expires_in: 1800,
        }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    const result = await testSingleConnection("conn-xai");

    expect(result.valid).toBe(true);
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      "https://auth.x.ai/oauth2/token",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Content-Type": "application/x-www-form-urlencoded" }),
      })
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      3,
      "https://api.x.ai/v1/models",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer new-access-token" }),
      })
    );
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith(
      "conn-xai",
      expect.objectContaining({
        testStatus: "active",
        lastError: null,
        accessToken: "new-access-token",
        refreshToken: "new-refresh-token",
        expiresAt: expect.any(String),
      })
    );
  });
});
