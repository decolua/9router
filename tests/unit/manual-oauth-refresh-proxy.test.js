import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

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
  normalizeExplicitProxyOptions(proxyOptions) {
    const hasProxy = proxyOptions?.connectionProxyEnabled === true && proxyOptions?.connectionProxyUrl;
    return hasProxy || proxyOptions?.vercelRelayUrl || proxyOptions?.proxyUnavailable
      ? proxyOptions
      : { disableEnvProxy: true };
  },
  proxyAwareFetch: mocks.proxyAwareFetch,
}));

import { testSingleConnection } from "../../src/app/api/providers/[id]/test/testUtils.js";

const originalFetch = globalThis.fetch;

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
      ok: true,
      status: 200,
      json: async () => ({ access_token: "fresh-token", expires_in: 3600 }),
      text: async () => "{}",
    });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "fresh-token",
        accessToken: "fresh-token",
        refresh_token: "fresh-refresh-token",
        refreshToken: "fresh-refresh-token",
        expires_in: 3600,
        expiresIn: 3600,
      }),
      text: async () => "{}",
    });
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
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

  it.each(["gemini-cli", "antigravity", "claude", "kiro", "qwen"])(
    "passes selected proxy to shared %s manual refresh",
    async (provider) => {
      const providerConnection = { ...connection, id: `${provider}-test`, provider };
      mocks.getProviderConnectionById.mockResolvedValue(providerConnection);

      await testSingleConnection(providerConnection.id);

      expect(mocks.refreshProviderCredentials).toHaveBeenCalledWith(
        provider,
        providerConnection,
        console,
        effectiveProxy,
      );
    },
  );

  it("uses selected proxy for Cline manual refresh", async () => {
    const clineConnection = { ...connection, id: "cline-test", provider: "cline" };
    mocks.getProviderConnectionById.mockResolvedValue(clineConnection);
    mocks.proxyAwareFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { accessToken: "fresh-token", refreshToken: "fresh-refresh-token" } }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    await testSingleConnection(clineConnection.id);

    expect(mocks.proxyAwareFetch).toHaveBeenCalledTimes(2);
    expect(mocks.proxyAwareFetch.mock.calls.every((call) => call[2] === effectiveProxy)).toBe(true);
  });
});
