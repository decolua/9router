import { beforeEach, describe, expect, it, vi } from "vitest";

const mockConnections = [];
const getProviderConnections = vi.fn(async () => mockConnections);
const validateApiKey = vi.fn(async () => true);
const updateProviderConnection = vi.fn(async (id, data) => ({ id, ...data }));
const getSettings = vi.fn(async () => ({
  fallbackStrategy: "fill-first",
  stickyRoundRobinLimit: 3,
  providerStrategies: {},
}));
const getEligibleConnections = vi.fn(async () => null);
const resolveConnectionProxyConfig = vi.fn(async () => ({
  connectionProxyEnabled: false,
  connectionProxyUrl: "",
  connectionNoProxy: false,
  proxyPoolId: null,
  vercelRelayUrl: "",
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections,
  validateApiKey,
  updateProviderConnection,
  getSettings,
}));

vi.mock("@/lib/providerHotState", () => ({
  getEligibleConnections,
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig,
}));

vi.mock("@/shared/constants/providers.js", () => ({
  resolveProviderId: (provider) => provider,
  FREE_PROVIDERS: {},
}));

vi.mock("open-sse/services/accountFallback.js", () => ({
  formatRetryAfter: vi.fn((value) => value),
  checkFallbackError: vi.fn(() => ({ shouldFallback: false, cooldownMs: 0, newBackoffLevel: 0 })),
  isModelLockActive: vi.fn((connection, model) => {
    if (!connection || !model) return false;
    const expiry = connection[`modelLock_${model}`] || connection.modelLock___all;
    return Boolean(expiry) && new Date(expiry).getTime() > Date.now();
  }),
  buildModelLockUpdate: vi.fn(() => ({ modelLock___all: null })),
  getEarliestModelLockUntil: vi.fn(() => null),
}));

describe("auth account selection", () => {
  beforeEach(() => {
    mockConnections.length = 0;
    getProviderConnections.mockClear();
    validateApiKey.mockClear();
    updateProviderConnection.mockClear();
    getSettings.mockClear();
    getEligibleConnections.mockClear();
    resolveConnectionProxyConfig.mockClear();
    getProviderConnections.mockResolvedValue(mockConnections);
    getSettings.mockResolvedValue({
      fallbackStrategy: "fill-first",
      stickyRoundRobinLimit: 3,
      providerStrategies: {},
    });
    getEligibleConnections.mockResolvedValue(null);
    resolveConnectionProxyConfig.mockResolvedValue({
      connectionProxyEnabled: false,
      connectionProxyUrl: "",
      connectionNoProxy: false,
      proxyPoolId: null,
      vercelRelayUrl: "",
    });
    vi.resetModules();
  });

  it("prefers centralized eligible accounts over merely available ones", async () => {
    mockConnections.push(
      {
        id: "conn-blocked",
        provider: "codex",
        isActive: true,
        priority: 1,
        displayName: "Blocked first",
        accessToken: "blocked-token",
        testStatus: "active",
      },
      {
        id: "conn-eligible",
        provider: "codex",
        isActive: true,
        priority: 2,
        displayName: "Eligible second",
        accessToken: "eligible-token",
        testStatus: "active",
      },
    );
    getEligibleConnections.mockResolvedValueOnce([mockConnections[1]]);

    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
    const credentials = await getProviderCredentials("codex", null, "gpt-4.1");

    expect(getEligibleConnections).toHaveBeenCalledWith("codex", expect.arrayContaining([
      expect.objectContaining({ id: "conn-blocked" }),
      expect.objectContaining({ id: "conn-eligible" }),
    ]));
    expect(credentials.connectionId).toBe("conn-eligible");
    expect(credentials.accessToken).toBe("eligible-token");
  });

  it("selects an untouched healthy account instead of falling back to a higher-priority blocked account", async () => {
    mockConnections.push(
      {
        id: "conn-blocked",
        provider: "codex",
        isActive: true,
        priority: 1,
        displayName: "Blocked first",
        accessToken: "blocked-token",
        testStatus: "active",
      },
      {
        id: "conn-untouched",
        provider: "codex",
        isActive: true,
        priority: 2,
        displayName: "Untouched second",
        accessToken: "healthy-token",
        testStatus: "active",
      },
    );
    getEligibleConnections.mockResolvedValueOnce([mockConnections[1]]);

    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
    const credentials = await getProviderCredentials("codex", null, "gpt-4.1");

    expect(credentials.connectionId).toBe("conn-untouched");
    expect(credentials.accessToken).toBe("healthy-token");
  });

  it("selects an untouched unknown-status account instead of falling back to a higher-priority blocked account", async () => {
    mockConnections.push(
      {
        id: "conn-blocked",
        provider: "codex",
        isActive: true,
        priority: 1,
        displayName: "Blocked first",
        accessToken: "blocked-token",
        testStatus: "active",
      },
      {
        id: "conn-untouched",
        provider: "codex",
        isActive: true,
        priority: 2,
        displayName: "Untouched second",
        accessToken: "healthy-token",
        testStatus: "unknown",
      },
    );
    getEligibleConnections.mockResolvedValueOnce([mockConnections[1]]);

    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
    const credentials = await getProviderCredentials("codex", null, "gpt-4.1");

    expect(credentials.connectionId).toBe("conn-untouched");
    expect(credentials.accessToken).toBe("healthy-token");
  });

  it("avoids excluded and model-locked accounts when using eligible selection", async () => {
    const futureLock = new Date(Date.now() + 60_000).toISOString();
    mockConnections.push(
      {
        id: "conn-excluded",
        provider: "codex",
        isActive: true,
        priority: 1,
        displayName: "Excluded",
        accessToken: "excluded-token",
        testStatus: "active",
      },
      {
        id: "conn-locked",
        provider: "codex",
        isActive: true,
        priority: 2,
        displayName: "Locked",
        accessToken: "locked-token",
        testStatus: "active",
        modelLock_gpt4: futureLock,
      },
      {
        id: "conn-eligible",
        provider: "codex",
        isActive: true,
        priority: 3,
        displayName: "Eligible",
        accessToken: "eligible-token",
        testStatus: "active",
      },
    );
    getEligibleConnections.mockImplementation(async (_provider, candidates) => candidates.filter((c) => c.id === "conn-eligible"));

    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
    const credentials = await getProviderCredentials("codex", new Set(["conn-excluded"]), "gpt4");

    expect(getEligibleConnections).toHaveBeenCalledWith("codex", [
      expect.objectContaining({ id: "conn-eligible" }),
    ]);
    expect(credentials.connectionId).toBe("conn-eligible");
  });

  it("does not fall back to raw available accounts when centralized eligibility is definitively empty", async () => {
    mockConnections.push(
      {
        id: "conn-blocked",
        provider: "codex",
        isActive: true,
        priority: 1,
        displayName: "Blocked first",
        accessToken: "blocked-token",
        testStatus: "active",
      },
      {
        id: "conn-second",
        provider: "codex",
        isActive: true,
        priority: 2,
        displayName: "Second",
        accessToken: "second-token",
        testStatus: "active",
      },
    );
    getEligibleConnections.mockResolvedValueOnce([]);

    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
    const credentials = await getProviderCredentials("codex", null, "gpt-4.1");

    expect(credentials).toBeNull();
  });

  it("falls back to available accounts when centralized eligibility is unavailable", async () => {
    mockConnections.push(
      {
        id: "conn-first",
        provider: "codex",
        isActive: true,
        priority: 1,
        displayName: "First",
        accessToken: "first-token",
        testStatus: "active",
      },
      {
        id: "conn-second",
        provider: "codex",
        isActive: true,
        priority: 2,
        displayName: "Second",
        accessToken: "second-token",
        testStatus: "active",
      },
    );
    getEligibleConnections.mockResolvedValueOnce(null);

    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
    const credentials = await getProviderCredentials("codex", null, "gpt-4.1");

    expect(credentials.connectionId).toBe("conn-first");
  });
});
