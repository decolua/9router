import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  resolveCopilotModels: vi.fn(),
  resolveClinepassModels: vi.fn(),
  resolveGrokCliModels: vi.fn(),
  resolveKimchiModels: vi.fn(),
  resolveKiroModels: vi.fn(),
  resolveQoderModels: vi.fn(),
  updateProviderCredentials: vi.fn(),
}));

vi.mock("@/shared/constants/models", () => ({
  PROVIDER_MODELS: {
    kiro: [{ id: "static-kiro" }],
    qoder: [{ id: "static-qoder" }],
    kimchi: [{ id: "static-kimchi" }],
    github: [{ id: "static-github" }],
    clinepass: [{ id: "static-clinepass" }],
    "grok-cli": [{ id: "static-grok" }],
  },
  PROVIDER_ID_TO_ALIAS: {},
  getModelKind: () => "llm",
}));
vi.mock("@/shared/constants/providers", () => ({
  AI_PROVIDERS: {
    kiro: { serviceKinds: ["llm"] },
    qoder: { serviceKinds: ["llm"] },
    kimchi: { serviceKinds: ["llm"] },
    github: { serviceKinds: ["llm"] },
    clinepass: { serviceKinds: ["llm"] },
    "grok-cli": { serviceKinds: ["llm"] },
  },
  getProviderAlias: (provider) => provider,
  isAnthropicCompatibleProvider: () => false,
  isOpenAICompatibleProvider: () => false,
}));
vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})),
}));
vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: vi.fn(async () => ({})),
}));
vi.mock("open-sse/services/kiroModels.js", () => ({ resolveKiroModels: mocks.resolveKiroModels }));
vi.mock("open-sse/services/qoderModels.js", () => ({ resolveQoderModels: mocks.resolveQoderModels }));
vi.mock("open-sse/services/kimchiModels.js", () => ({ resolveKimchiModels: mocks.resolveKimchiModels }));
vi.mock("open-sse/services/copilotModels.js", () => ({ resolveCopilotModels: mocks.resolveCopilotModels }));
vi.mock("open-sse/services/clinepassModels.js", () => ({ resolveClinepassModels: mocks.resolveClinepassModels }));
vi.mock("open-sse/services/grokCliModels.js", () => ({ resolveGrokCliModels: mocks.resolveGrokCliModels }));
vi.mock("@/sse/services/tokenRefresh", () => ({ updateProviderCredentials: mocks.updateProviderCredentials }));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
}));
vi.mock("open-sse/providers/capabilities.js", () => ({
  capabilitiesFromServiceKind: () => ({}),
  getCapabilitiesForModel: () => ({}),
}));

const proxyRoute = {
  source: "pool",
  proxyPoolId: "v1-models-pool",
  proxyPool: { id: "v1-models-pool" },
  connectionProxyEnabled: true,
  connectionProxyUrl: "http://proxy.test:8080",
  connectionNoProxy: "",
  strictProxy: true,
  disableEnvProxy: true,
  vercelRelayUrl: "",
};

describe("v1 live model proxy routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderConnections.mockResolvedValue(
      ["kiro", "qoder", "kimchi", "github", "clinepass", "grok-cli"].map((provider) => ({
        id: `${provider}-1`,
        provider,
        isActive: true,
        accessToken: `${provider}-access`,
        refreshToken: `${provider}-refresh`,
        providerSpecificData: { proxyPoolId: "v1-models-pool", userId: `${provider}-user` },
      })),
    );
    mocks.resolveConnectionProxyConfig.mockResolvedValue(proxyRoute);
    mocks.resolveKiroModels.mockResolvedValue({ models: [{ id: "kiro-live" }] });
    mocks.resolveQoderModels.mockResolvedValue({ models: [{ id: "qoder-live" }] });
    mocks.resolveKimchiModels.mockResolvedValue({ models: [{ id: "kimchi-live" }] });
    mocks.resolveCopilotModels.mockResolvedValue({ models: [{ id: "copilot-live" }] });
    mocks.resolveClinepassModels.mockResolvedValue({ models: [{ id: "clinepass-live" }] });
    mocks.resolveGrokCliModels.mockResolvedValue({ models: [{ id: "grok-live" }] });
  });

  it("passes each connection's complete route into live discovery", async () => {
    const { buildModelsList } = await import("../../src/app/api/v1/models/route.js");

    await buildModelsList(["llm"]);

    for (const resolver of [
      mocks.resolveKiroModels,
      mocks.resolveQoderModels,
      mocks.resolveKimchiModels,
      mocks.resolveCopilotModels,
      mocks.resolveClinepassModels,
      mocks.resolveGrokCliModels,
    ]) {
      expect(resolver).toHaveBeenCalledTimes(1);
      expect(resolver.mock.calls[0][1]).toEqual(expect.objectContaining({ proxyOptions: proxyRoute }));
    }
    expect(mocks.resolveConnectionProxyConfig).toHaveBeenCalledTimes(6);
  });

  it("does not invoke live discovery when a saved pool is unavailable", async () => {
    mocks.getProviderConnections.mockResolvedValue([{
      id: "kiro-missing",
      provider: "kiro",
      isActive: true,
      accessToken: "kiro-access",
      providerSpecificData: { proxyPoolId: "missing-pool" },
    }]);
    mocks.resolveConnectionProxyConfig.mockResolvedValue({
      source: "unavailable",
      proxyPoolId: "missing-pool",
      proxyUnavailable: true,
      strictProxy: true,
      disableEnvProxy: true,
    });
    const { buildModelsList } = await import("../../src/app/api/v1/models/route.js");

    await buildModelsList(["llm"]);

    expect(mocks.resolveKiroModels).not.toHaveBeenCalled();
  });

  it("sanitizes top-level model route errors in logs and responses", async () => {
    const secret = "https://user:password@provider.test/models?code=SECRET-CODE&access_token=SECRET-TOKEN";
    mocks.getProviderConnections.mockResolvedValue([{
      id: "kiro-secret",
      provider: "kiro",
      isActive: true,
      accessToken: "kiro-access",
      providerSpecificData: { proxyPoolId: "secret-pool" },
    }]);
    mocks.resolveConnectionProxyConfig.mockRejectedValue(new Error(secret));
    const logged = vi.spyOn(console, "log").mockImplementation(() => {});
    const { GET } = await import("../../src/app/api/v1/models/route.js");

    const response = await GET(new Request("http://localhost/v1/models"));
    const output = `${JSON.stringify(await response.json())} ${logged.mock.calls.flat().map(String).join(" ")}`;

    expect(response.status).toBe(500);
    for (const value of ["user", "password", "SECRET-CODE", "SECRET-TOKEN"]) {
      expect(output).not.toContain(value);
    }
  });
});
