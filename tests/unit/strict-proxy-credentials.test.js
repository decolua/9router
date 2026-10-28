import { beforeEach, describe, expect, it, vi } from "vitest";

const { getProviderConnections, getSettings, resolveConnectionProxyConfig } = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections,
  getProxyPools: vi.fn(),
  getSettings,
  updateProviderConnection: vi.fn(),
  validateApiKey: vi.fn(),
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  pickProxyPoolId: vi.fn(),
  resolveConnectionProxyConfig,
}));

vi.mock("@/shared/constants/providers.js", () => ({
  FREE_PROVIDERS: { public: { noAuth: true } },
  resolveProviderId: (provider) => provider,
}));

vi.mock("open-sse/services/accountFallback.js", () => ({
  buildModelLockUpdate: vi.fn(),
  checkFallbackError: vi.fn(),
  formatRetryAfter: vi.fn(),
  getEarliestModelLockUntil: vi.fn(),
  isModelLockActive: vi.fn(() => false),
}));

vi.mock("open-sse/config/errorConfig.js", () => ({
  MAX_RATE_LIMIT_COOLDOWN_MS: 300000,
}));

vi.mock("../../src/sse/services/antigravityQuota.js", () => ({
  getAntigravityQuotaCache: vi.fn(),
}));

vi.mock("../../src/sse/utils/logger.js", () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

const { getProviderCredentials } = await import("../../src/sse/services/auth.js");

const strictProxy = {
  connectionProxyEnabled: true,
  connectionProxyUrl: "https://proxy.example",
  connectionNoProxy: "internal.example",
  proxyPoolId: "pool-1",
  strictProxy: true,
  vercelRelayUrl: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  getSettings.mockResolvedValue({});
  resolveConnectionProxyConfig.mockResolvedValue(strictProxy);
});

describe("getProviderCredentials strict proxy propagation", () => {
  it("preserves strictProxy for authenticated connections", async () => {
    getProviderConnections.mockResolvedValue([{
      id: "connection-1",
      provider: "paid",
      authType: "api_key",
      accessToken: "token",
      isActive: true,
      providerSpecificData: { proxyPoolId: "pool-1" },
    }]);

    const credentials = await getProviderCredentials("paid");

    expect(credentials.providerSpecificData).toMatchObject({
      connectionProxyEnabled: true,
      connectionProxyUrl: "https://proxy.example",
      connectionNoProxy: "internal.example",
      connectionProxyPoolId: "pool-1",
      strictProxy: true,
    });
  });

  it("preserves strictProxy for no-auth providers", async () => {
    getSettings.mockResolvedValue({
      providerStrategies: { public: { proxyPoolId: "pool-1" } },
    });

    const credentials = await getProviderCredentials("public");

    expect(credentials.providerSpecificData).toMatchObject({
      connectionProxyEnabled: true,
      connectionProxyUrl: "https://proxy.example",
      connectionProxyPoolId: "pool-1",
      strictProxy: true,
    });
  });
});
