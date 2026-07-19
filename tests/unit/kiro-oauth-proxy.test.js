import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchKiroProfileArn: vi.fn(),
  proxyAwareFetch: vi.fn(),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  normalizeExplicitProxyOptions: (proxyOptions) => proxyOptions,
  proxyAwareFetch: mocks.proxyAwareFetch,
}));
vi.mock("../../src/lib/oauth/providers.js", () => ({
  fetchKiroProfileArn: mocks.fetchKiroProfileArn,
}));

import { refreshProviderCredentials } from "../../open-sse/services/oauthCredentialManager.js";

describe("Kiro OAuth proxy propagation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchKiroProfileArn.mockResolvedValue(
      "arn:aws:codewhisperer:us-east-1:123456789012:profile/ABC",
    );
    mocks.proxyAwareFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        accessToken: "new-access",
        refreshToken: "new-refresh",
        expiresIn: 3600,
      }),
    });
  });

  it("preserves selected proxy during proactive token refresh", async () => {
    const proxyOptions = {
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy.test:8080",
      connectionNoProxy: "localhost",
      vercelRelayUrl: "",
      strictProxy: true,
    };
    await refreshProviderCredentials("kiro", {
      connectionId: "kiro-proxied-refresh",
      refreshToken: "old-refresh",
      providerSpecificData: {
        authMethod: "social",
        connectionProxyEnabled: true,
        connectionProxyUrl: "http://proxy.test:8080",
        connectionNoProxy: "localhost",
        proxyPoolId: "pool-1",
        strictProxy: true,
      },
    }, null);

    expect(mocks.proxyAwareFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ method: "POST" }),
      proxyOptions,
    );
    expect(mocks.fetchKiroProfileArn).toHaveBeenCalledWith("new-access", proxyOptions);
  });
});
