import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  testProxyUrl: vi.fn(),
  refreshProviderCredentials: vi.fn(),
  shouldRefreshCredentials: vi.fn(),
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

vi.mock("open-sse/services/oauthCredentialManager.js", () => ({
  refreshProviderCredentials: mocks.refreshProviderCredentials,
  shouldRefreshCredentials: mocks.shouldRefreshCredentials,
}));

vi.mock("open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: mocks.proxyAwareFetch,
}));

import { testSingleConnection } from "../../src/app/api/providers/[id]/test/testUtils.js";

const connection = {
  id: "codex-test",
  provider: "codex",
  authType: "oauth",
  accessToken: "expired-token",
  refreshToken: "refresh-token",
  providerSpecificData: {},
};

const effectiveProxy = {
  connectionProxyEnabled: true,
  connectionProxyUrl: "http://proxy.test:8080",
  connectionNoProxy: "localhost",
  vercelRelayUrl: "",
  strictProxy: true,
};

describe("manual OAuth test refresh routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderConnectionById.mockResolvedValue(connection);
    mocks.updateProviderConnection.mockResolvedValue(true);
    mocks.resolveConnectionProxyConfig.mockResolvedValue(effectiveProxy);
    mocks.testProxyUrl.mockResolvedValue({ ok: true });
    mocks.shouldRefreshCredentials.mockReturnValue(true);
    mocks.refreshProviderCredentials.mockResolvedValue({
      accessToken: "fresh-token",
      refreshToken: "fresh-refresh-token",
      expiresIn: 3600,
    });
    mocks.proxyAwareFetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "invalid request",
    });
  });

  it("passes selected proxy to refreshProviderCredentials", async () => {
    const result = await testSingleConnection(connection.id);

    expect(result.valid).toBe(true);
    expect(mocks.refreshProviderCredentials).toHaveBeenCalledWith(
      "codex",
      connection,
      console,
      effectiveProxy,
    );
  });
});
