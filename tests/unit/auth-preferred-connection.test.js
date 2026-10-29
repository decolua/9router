import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  getObservedConnectionModelLock: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  validateApiKey: vi.fn(),
  updateProviderConnection: vi.fn(),
  getSettings: mocks.getSettings,
  getApiKeyMetadata: vi.fn(),
  getDailyUsageForApiKey: vi.fn(),
  extendConnectionModelLock: vi.fn(),
  clearConnectionModelLockIfObserved: vi.fn(),
  getObservedConnectionModelLock: mocks.getObservedConnectionModelLock,
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
}));

describe("getProviderCredentials preferred connection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ providerStrategies: {}, fallbackStrategy: "fill-first" });
    mocks.resolveConnectionProxyConfig.mockResolvedValue({
      connectionProxyEnabled: false,
      connectionProxyUrl: "",
      connectionNoProxy: "",
      proxyPoolId: null,
      vercelRelayUrl: "",
    });
  });

  it("does not fall back to another account when the pinned combo account is disabled", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      { id: "active-1", provider: "openai", isActive: true, name: "Active fallback", priority: 1 },
    ]);

    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");

    const credentials = await getProviderCredentials("openai", null, "gpt-4o", {
      preferredConnectionId: "disabled-1",
    });

    expect(credentials).toBeNull();
  });

  it("uses the pinned combo account when it is active", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      { id: "preferred-1", provider: "openai", isActive: true, name: "Pinned", priority: 2 },
      { id: "active-1", provider: "openai", isActive: true, name: "Fallback", priority: 1 },
    ]);

    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");

    const credentials = await getProviderCredentials("openai", null, "gpt-4o", {
      preferredConnectionId: "preferred-1",
    });

    expect(credentials?.connectionId).toBe("preferred-1");
  });
});
