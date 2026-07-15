import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  updateProviderConnection: vi.fn(),
  validateApiKey: vi.fn(),
  getProxyPools: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  pickProxyPoolId: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getSettings: mocks.getSettings,
  updateProviderConnection: mocks.updateProviderConnection,
  validateApiKey: mocks.validateApiKey,
  getProxyPools: mocks.getProxyPools,
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
  pickProxyPoolId: mocks.pickProxyPoolId,
}));

const { getProviderCredentials, resetProviderSessionAffinity } = await import("../../src/sse/services/auth.js");

function makeConnection(id, priority) {
  return {
    id,
    provider: "kiro",
    authType: "oauth",
    accessToken: `token-${id}`,
    isActive: true,
    priority,
    providerSpecificData: {},
  };
}

describe("provider round-robin session affinity", () => {
  let connections;

  beforeEach(() => {
    vi.clearAllMocks();
    resetProviderSessionAffinity();
    connections = [
      makeConnection("conn-a", 1),
      makeConnection("conn-b", 2),
    ];
    mocks.getProviderConnections.mockResolvedValue(connections);
    mocks.getSettings.mockResolvedValue({
      fallbackStrategy: "round-robin",
      stickyRoundRobinLimit: 1,
      providerStrategies: {},
    });
    mocks.resolveConnectionProxyConfig.mockResolvedValue({});
    mocks.updateProviderConnection.mockImplementation(async (id, updates) => {
      Object.assign(connections.find((c) => c.id === id), updates);
      return true;
    });
  });

  it("keeps the same session on the same account even when sticky limit is one", async () => {
    const first = await getProviderCredentials("kiro", null, "claude-sonnet-4.5", {
      sessionId: "hermes-thread-1",
    });
    const second = await getProviderCredentials("kiro", null, "claude-sonnet-4.5", {
      sessionId: "hermes-thread-1",
    });

    expect(first.connectionId).toBe("conn-a");
    expect(second.connectionId).toBe("conn-a");
  });

  it("assigns different sessions using least-recently-used round robin", async () => {
    const first = await getProviderCredentials("kiro", null, "claude-sonnet-4.5", {
      sessionId: "hermes-thread-1",
    });
    const second = await getProviderCredentials("kiro", null, "claude-sonnet-4.5", {
      sessionId: "hermes-thread-2",
    });
    const firstAgain = await getProviderCredentials("kiro", null, "claude-sonnet-4.5", {
      sessionId: "hermes-thread-1",
    });

    expect(first.connectionId).toBe("conn-a");
    expect(second.connectionId).toBe("conn-b");
    expect(firstAgain.connectionId).toBe("conn-a");
  });

  it("moves a session to another account when the sticky account is excluded", async () => {
    const first = await getProviderCredentials("kiro", null, "claude-sonnet-4.5", {
      sessionId: "hermes-thread-1",
    });
    const fallback = await getProviderCredentials("kiro", new Set(["conn-a"]), "claude-sonnet-4.5", {
      sessionId: "hermes-thread-1",
    });
    const afterFallback = await getProviderCredentials("kiro", null, "claude-sonnet-4.5", {
      sessionId: "hermes-thread-1",
    });

    expect(first.connectionId).toBe("conn-a");
    expect(fallback.connectionId).toBe("conn-b");
    expect(afterFallback.connectionId).toBe("conn-b");
  });

  it("keeps existing request-count round robin for traffic without a session", async () => {
    const first = await getProviderCredentials("kiro", null, "claude-sonnet-4.5");
    const second = await getProviderCredentials("kiro", null, "claude-sonnet-4.5");

    expect(first.connectionId).toBe("conn-a");
    expect(second.connectionId).toBe("conn-b");
  });
});
