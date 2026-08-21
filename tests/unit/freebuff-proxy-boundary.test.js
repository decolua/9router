import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  validateApiKey: vi.fn(),
  updateProviderConnection: vi.fn(),
  getSettings: mocks.getSettings,
  getProxyPools: vi.fn(),
  getApiKeyMetadata: vi.fn(),
  touchApiKey: vi.fn(),
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
  pickProxyPoolId: vi.fn(),
}));

describe("Freebuff credential selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({
      providerStrategies: { freebuff: { strictModelAssignment: true } },
      fallbackStrategy: "fill-first",
    });
    mocks.resolveConnectionProxyConfig.mockResolvedValue({
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy",
      connectionNoProxy: "",
      proxyPoolId: "pool-a",
      vercelRelayUrl: "",
      strictProxy: true,
    });
  });

  it("filters strict Freebuff assignments before selecting a credential and scopes the selected model", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      { id: "wrong", provider: "freebuff", name: "Wrong", priority: 1, providerSpecificData: { assignedModel: "model-b" } },
      { id: "right", provider: "freebuff", name: "Right", priority: 2, providerSpecificData: { assignedModel: "model-a" } },
    ]);
    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");

    const credentials = await getProviderCredentials("freebuff", null, "model-a");

    expect(credentials?.connectionId).toBe("right");
    expect(mocks.resolveConnectionProxyConfig).toHaveBeenCalledWith(
      expect.objectContaining({ proxyPoolScope: "freebuff::model-a" }),
      "right"
    );
  });

  it("preserves non-Freebuff credential selection when strict Freebuff assignment is enabled", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      { id: "openai-1", provider: "openai", name: "OpenAI", priority: 1, providerSpecificData: {} },
    ]);
    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");

    const credentials = await getProviderCredentials("openai", null, "model-a");

    expect(credentials?.connectionId).toBe("openai-1");
  });

  it("enforces strict assignment edge cases and keeps non-strict Freebuff untouched", async () => {
    const { filterConnectionsForModel } = await import("../../src/sse/services/auth.js");
    const connections = [
      { id: "assigned", providerSpecificData: { assignedModel: "model-a" } },
      { id: "legacy", providerSpecificData: { freebuffModel: "model-a" } },
      { id: "cleared", providerSpecificData: { assignedModel: null, freebuffModel: "model-a" } },
      { id: "unassigned", providerSpecificData: {} },
    ];
    const strictSettings = { providerStrategies: { freebuff: { strictModelAssignment: true } } };

    expect(filterConnectionsForModel("freebuff", connections, "model-a", strictSettings).map(({ id }) => id)).toEqual(["assigned", "legacy"]);
    expect(filterConnectionsForModel("freebuff", connections, "", strictSettings)).toBe(connections);
    expect(filterConnectionsForModel("freebuff", connections, "model-a", {})).toBe(connections);
    expect(filterConnectionsForModel("openai", connections, "model-a", strictSettings)).toBe(connections);
  });

  it("uses an empty model segment rather than a wildcard for Freebuff pool scope", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      { id: "right", provider: "freebuff", name: "Right", priority: 1, providerSpecificData: { assignedModel: "model-a" } },
    ]);
    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");

    await getProviderCredentials("freebuff", null, "");

    expect(mocks.resolveConnectionProxyConfig).toHaveBeenCalledWith(
      expect.objectContaining({ proxyPoolScope: "freebuff::" }),
      "right"
    );
  });
});
