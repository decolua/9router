import { describe, it, expect, beforeEach, vi } from "vitest";

// #4249 / #4246 — the dashboard's "disabled model" toggle only wrote the
// `disabledModels` kv scope, which was read by the UI and /v1/models but never
// by the routing path. A model switched off in the dashboard kept being routed.

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  getProxyPools: vi.fn(),
  updateProviderConnection: vi.fn(),
  validateApiKey: vi.fn(),
  getDisabledByProvider: vi.fn(),
  resolveProviderId: vi.fn(),
  getProviderAlias: vi.fn(),
  FREE_PROVIDERS: {},
  isModelLockActive: vi.fn(),
  buildModelLockUpdate: vi.fn(),
  getEarliestModelLockUntil: vi.fn(),
  checkFallbackError: vi.fn(),
  formatRetryAfter: vi.fn(),
  MAX_RATE_LIMIT_COOLDOWN_MS: 300000,
  getAntigravityQuotaCache: vi.fn(),
  getAntigravityModelQuota: vi.fn(),
  getAntigravityUsage: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getSettings: mocks.getSettings,
  getProxyPools: mocks.getProxyPools,
  updateProviderConnection: mocks.updateProviderConnection,
  validateApiKey: mocks.validateApiKey,
}));

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledByProvider: mocks.getDisabledByProvider,
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn().mockResolvedValue({
    connectionProxyEnabled: false,
    connectionProxyUrl: "",
    connectionNoProxy: "",
    proxyPoolId: null,
    vercelRelayUrl: "",
  }),
  pickProxyPoolId: vi.fn().mockReturnValue(null),
}));

vi.mock("@/shared/constants/providers.js", () => ({
  resolveProviderId: mocks.resolveProviderId,
  getProviderAlias: mocks.getProviderAlias,
  FREE_PROVIDERS: mocks.FREE_PROVIDERS,
}));

vi.mock("open-sse/services/accountFallback.js", () => ({
  formatRetryAfter: mocks.formatRetryAfter,
  checkFallbackError: mocks.checkFallbackError,
  isModelLockActive: mocks.isModelLockActive,
  buildModelLockUpdate: mocks.buildModelLockUpdate,
  getEarliestModelLockUntil: mocks.getEarliestModelLockUntil,
}));

vi.mock("open-sse/config/errorConfig.js", () => ({
  MAX_RATE_LIMIT_COOLDOWN_MS: mocks.MAX_RATE_LIMIT_COOLDOWN_MS,
}));

vi.mock("open-sse/services/usage/google.js", () => ({
  getAntigravityUsage: mocks.getAntigravityUsage,
}));

vi.mock("@/sse/services/antigravityQuota.js", () => ({
  getAntigravityQuotaCache: mocks.getAntigravityQuotaCache,
  getAntigravityModelQuota: mocks.getAntigravityModelQuota,
}));

vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

const { getProviderCredentials } = await import("../../src/sse/services/auth.js");

const ACTIVE_CONNECTION = {
  id: "conn-11111111",
  connectionName: "acct-1",
  isActive: true,
  accessToken: "token-1",
  priority: 1,
};

describe("#4249 disabled models are rejected at routing time", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderConnections.mockResolvedValue([{ ...ACTIVE_CONNECTION }]);
    mocks.getSettings.mockResolvedValue({ fallbackStrategy: "fill-first" });
    mocks.getProxyPools.mockResolvedValue([]);
    mocks.getDisabledByProvider.mockResolvedValue([]);
    mocks.resolveProviderId.mockImplementation((provider) => provider);
    mocks.getProviderAlias.mockImplementation((providerId) => providerId);
    mocks.FREE_PROVIDERS = {};
    mocks.isModelLockActive.mockReturnValue(false);
    mocks.getEarliestModelLockUntil.mockReturnValue(null);
    mocks.formatRetryAfter.mockReturnValue("1m");
    mocks.getAntigravityQuotaCache.mockReturnValue(new Map());
    mocks.getAntigravityModelQuota.mockReturnValue(null);
  });

  it("returns no credentials for a model disabled in the dashboard", async () => {
    mocks.getDisabledByProvider.mockResolvedValue(["glm-5.3-flash"]);

    const credentials = await getProviderCredentials("nvidia", null, "glm-5.3-flash");

    expect(credentials).toBeNull();
  });

  it("does not hit the connection pool when the model is disabled", async () => {
    mocks.getDisabledByProvider.mockResolvedValue(["glm-5.3-flash"]);

    await getProviderCredentials("nvidia", null, "glm-5.3-flash");

    // Rejecting before connection lookup is what avoids burning the
    // full upstream connect timeout on a model the user already turned off.
    expect(mocks.getProviderConnections).not.toHaveBeenCalled();
  });

  it("still routes a model that is not disabled", async () => {
    mocks.getDisabledByProvider.mockResolvedValue(["some-other-model"]);

    const credentials = await getProviderCredentials("nvidia", null, "glm-5.3-flash");

    expect(credentials).not.toBeNull();
    expect(credentials.accessToken).toBe("token-1");
  });

  it("routes normally when no model is disabled", async () => {
    const credentials = await getProviderCredentials("nvidia", null, "glm-5.3-flash");

    expect(credentials).not.toBeNull();
    expect(credentials.accessToken).toBe("token-1");
  });

  it("ignores the gate for requests without a model", async () => {
    mocks.getDisabledByProvider.mockResolvedValue(["glm-5.3-flash"]);

    const credentials = await getProviderCredentials("nvidia", null, null);

    expect(credentials).not.toBeNull();
  });

  it("fails open when the disabled-model lookup throws", async () => {
    mocks.getDisabledByProvider.mockRejectedValue(new Error("db unavailable"));

    const credentials = await getProviderCredentials("nvidia", null, "glm-5.3-flash");

    // A DB hiccup must never take routing down.
    expect(credentials).not.toBeNull();
  });
});