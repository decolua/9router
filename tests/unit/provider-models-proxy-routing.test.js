import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  resolveGrokCliModels: vi.fn(),
  resolveKimchiModels: vi.fn(),
  resolveKiroModels: vi.fn(),
  resolveQoderModels: vi.fn(),
  refreshGoogleToken: vi.fn(),
  updateProviderCredentials: vi.fn(),
}));

vi.mock("@/models", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
}));
vi.mock("@/shared/constants/providers", () => ({
  isOpenAICompatibleProvider: (provider) => provider === "compatible-openai",
  isAnthropicCompatibleProvider: () => false,
}));
vi.mock("@/lib/oauth/constants/oauth", () => ({
  GEMINI_CONFIG: { clientId: "gemini-client", clientSecret: "gemini-secret" },
}));
vi.mock("@/sse/services/tokenRefresh", () => ({
  refreshGoogleToken: mocks.refreshGoogleToken,
  updateProviderCredentials: mocks.updateProviderCredentials,
}));
vi.mock("open-sse/config/providers.js", () => ({
  resolveOllamaLocalHost: () => "http://localhost:11434",
}));
vi.mock("open-sse/config/providerModels.js", () => ({
  getModelsByProviderId: () => [{ id: "static-model", name: "Static Model" }],
}));
vi.mock("open-sse/services/kiroModels.js", () => ({
  resolveKiroModels: mocks.resolveKiroModels,
}));
vi.mock("open-sse/services/kimchiModels.js", () => ({
  resolveKimchiModels: mocks.resolveKimchiModels,
}));
vi.mock("open-sse/services/qoderModels.js", () => ({
  resolveQoderModels: mocks.resolveQoderModels,
}));
vi.mock("open-sse/services/grokCliModels.js", () => ({
  resolveGrokCliModels: mocks.resolveGrokCliModels,
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
}));

const originalFetch = globalThis.fetch;
const proxyRoute = {
  source: "pool",
  proxyPoolId: "models-pool",
  proxyPool: { id: "models-pool" },
  proxyUnavailable: false,
  connectionProxyEnabled: true,
  connectionProxyUrl: "http://proxy.test:8080",
  connectionNoProxy: "",
  vercelRelayUrl: "",
  strictProxy: true,
  disableEnvProxy: true,
};

function connection(provider) {
  return {
    id: `${provider}-connection`,
    provider,
    authType: "oauth",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    apiKey: "api-key",
    providerSpecificData: { proxyPoolId: "models-pool", userId: "user-1" },
  };
}

async function getModels(provider) {
  mocks.getProviderConnectionById.mockResolvedValue(connection(provider));
  const { GET } = await import("../../src/app/api/providers/[id]/models/route.js");
  return GET(new Request(`http://localhost/api/providers/${provider}-connection/models`), {
    params: Promise.resolve({ id: `${provider}-connection` }),
  });
}

describe("provider models route proxy routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveConnectionProxyConfig.mockResolvedValue(proxyRoute);
    mocks.resolveKiroModels.mockResolvedValue({ models: [{ id: "kiro-model", name: "Kiro Model" }] });
    mocks.resolveQoderModels.mockResolvedValue({ models: [{ id: "qoder-model", name: "Qoder Model" }] });
    mocks.resolveKimchiModels.mockResolvedValue({ models: [{ id: "kimchi-model", name: "Kimchi Model" }] });
    mocks.resolveGrokCliModels.mockResolvedValue({ models: [{ id: "grok-model", name: "Grok Model" }] });
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "model-1" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it.each([
    ["kiro", mocks.resolveKiroModels],
    ["qoder", mocks.resolveQoderModels],
    ["kimchi", mocks.resolveKimchiModels],
    ["grok-cli", mocks.resolveGrokCliModels],
  ])("passes the complete route to %s live discovery", async (provider, resolver) => {
    const response = await getModels(provider);

    expect(response.status).toBe(200);
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(resolver.mock.calls[0][1]).toEqual(expect.objectContaining({ proxyOptions: proxyRoute }));
  });

  it("uses the complete route for generic compatible discovery", async () => {
    const compatible = connection("compatible-openai");
    compatible.providerSpecificData.baseUrl = "https://compatible.test/v1";
    mocks.getProviderConnectionById.mockResolvedValue(compatible);
    const { GET } = await import("../../src/app/api/providers/[id]/models/route.js");

    const response = await GET(new Request("http://localhost/api/providers/compatible-openai-connection/models"), {
      params: Promise.resolve({ id: "compatible-openai-connection" }),
    });

    expect(response.status).toBe(200);
    expect(globalThis.fetch.mock.calls[0][1].proxyOptions).toBe(proxyRoute);
  });

  it("uses the complete route for Ollama local discovery", async () => {
    const response = await getModels("ollama-local");

    expect(response.status).toBe(200);
    expect(globalThis.fetch.mock.calls[0][1].proxyOptions).toBe(proxyRoute);
  });

  it("does not log Ollama provider response bodies", async () => {
    const secret = "https://user:password@provider.test/models?access_token=SECRET-TOKEN";
    globalThis.fetch.mockResolvedValue(new Response(secret, { status: 500 }));
    const logged = vi.spyOn(console, "log").mockImplementation(() => {});

    await getModels("ollama-local");
    const output = logged.mock.calls.flat().map(String).join(" ");

    for (const value of ["user", "password", "SECRET-TOKEN"]) expect(output).not.toContain(value);
  });

  it("uses the complete route for Gemini CLI refresh and both fetch attempts", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(new Response("expired", { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ id: "gemini-model" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    mocks.refreshGoogleToken.mockResolvedValue({ accessToken: "new-access", refreshToken: "new-refresh" });

    const response = await getModels("gemini-cli");

    expect(response.status).toBe(200);
    expect(mocks.refreshGoogleToken).toHaveBeenCalledWith(
      "refresh-token",
      "gemini-client",
      "gemini-secret",
      proxyRoute,
    );
    expect(globalThis.fetch.mock.calls.every((call) => call[1].proxyOptions === proxyRoute)).toBe(true);
  });

  it("rejects unavailable saved routing before discovery I/O", async () => {
    mocks.resolveConnectionProxyConfig.mockResolvedValue({
      source: "unavailable",
      proxyPoolId: "missing-pool",
      proxyUnavailable: true,
      strictProxy: true,
      disableEnvProxy: true,
    });

    const response = await getModels("kiro");

    expect(response.status).toBe(503);
    expect(mocks.resolveKiroModels).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("does not expose provider bodies in warnings or logs", async () => {
    const secret = "https://user:password@provider.test/models?code=SECRET-CODE&access_token=SECRET-TOKEN";
    globalThis.fetch.mockResolvedValue(new Response(secret, { status: 500 }));
    const logged = vi.spyOn(console, "log").mockImplementation(() => {});

    const response = await getModels("gemini-cli");
    const body = await response.json();
    const output = `${body.warning || ""} ${logged.mock.calls.flat().map(String).join(" ")}`;

    for (const value of ["user", "password", "SECRET-CODE", "SECRET-TOKEN"]) {
      expect(output).not.toContain(value);
    }
  });

  it("sanitizes warnings returned by nested live resolvers", async () => {
    const secret = "https://user:password@provider.test/models?code=SECRET-CODE&access_token=SECRET-TOKEN";
    mocks.resolveGrokCliModels.mockResolvedValue({ models: [], warning: secret });

    const response = await getModels("grok-cli");
    const output = JSON.stringify(await response.json());

    for (const value of ["user", "password", "SECRET-CODE", "SECRET-TOKEN"]) {
      expect(output).not.toContain(value);
    }
  });
});
