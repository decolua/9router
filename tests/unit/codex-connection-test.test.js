import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  testProxyUrl: vi.fn(),
  proxyAwareFetch: vi.fn(),
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

vi.mock("open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: mocks.proxyAwareFetch,
}));

const { testSingleConnection } = await import("../../src/app/api/providers/[id]/test/testUtils.js");

const connection = {
  id: "conn-codex",
  provider: "codex",
  authType: "oauth",
  accessToken: "access-token",
  refreshToken: "refresh-token",
  expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  providerSpecificData: {},
};

describe("Codex OAuth connection test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderConnectionById.mockResolvedValue({ ...connection });
    mocks.resolveConnectionProxyConfig.mockResolvedValue({});
  });

  it("validates auth through the non-inference models endpoint", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const result = await testSingleConnection("conn-codex");

    expect(result.valid).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://chatgpt.com/backend-api/codex/models?client_version=1.0.0",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer access-token" }),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(global.fetch.mock.calls[0][1]).not.toHaveProperty("body");
  });

  it("keeps strict proxy semantics during account validation", async () => {
    const proxyConfig = {
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy.example:8080",
      connectionNoProxy: "localhost",
      strictProxy: true,
    };
    mocks.resolveConnectionProxyConfig.mockResolvedValue(proxyConfig);
    mocks.testProxyUrl.mockResolvedValue({ ok: true, status: 200 });
    mocks.proxyAwareFetch.mockResolvedValue({ ok: true, status: 200 });

    const result = await testSingleConnection("conn-codex");

    expect(result.valid).toBe(true);
    expect(mocks.proxyAwareFetch).toHaveBeenCalledWith(
      "https://chatgpt.com/backend-api/codex/models?client_version=1.0.0",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      expect.objectContaining({
        connectionProxyEnabled: true,
        connectionProxyUrl: proxyConfig.connectionProxyUrl,
        strictProxy: true,
      }),
    );
  });
});
