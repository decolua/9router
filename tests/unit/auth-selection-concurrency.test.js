import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  updateProviderConnection: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getApiKeyByValue: vi.fn(),
  getApiKeyGroupById: vi.fn(),
  validateApiKey: vi.fn(),
  updateProviderConnection: mocks.updateProviderConnection,
  getSettings: mocks.getSettings,
  getProxyPools: vi.fn(),
  getModelMappings: vi.fn(),
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
  pickProxyPoolId: vi.fn(),
}));

vi.mock("@/sse/utils/logger.js", () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const { getProviderCredentials } = await import("@/sse/services/auth.js");

const connection = (provider) => ({
  id: `${provider}-connection`,
  provider,
  name: provider,
  isActive: true,
  apiKey: `${provider}-key`,
  providerSpecificData: {},
});

describe("provider credential selection concurrency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ fallbackStrategy: "fill-first" });
    mocks.resolveConnectionProxyConfig.mockResolvedValue({});
  });

  it("does not serialize account selection across different providers", async () => {
    let releaseOpenAi;
    let markOpenAiEntered;
    const openAiGate = new Promise((resolve) => { releaseOpenAi = resolve; });
    const openAiEntered = new Promise((resolve) => { markOpenAiEntered = resolve; });

    mocks.getProviderConnections.mockImplementation(async ({ provider }) => {
      if (provider === "openai") {
        markOpenAiEntered();
        await openAiGate;
      }
      return [connection(provider)];
    });

    const openAiRequest = getProviderCredentials("openai");
    await openAiEntered;

    const anthropicCredentials = await getProviderCredentials("anthropic");
    expect(anthropicCredentials.connectionId).toBe("anthropic-connection");

    releaseOpenAi();
    await expect(openAiRequest).resolves.toMatchObject({ connectionId: "openai-connection" });
  });

  it("still serializes selection within the same provider", async () => {
    let releaseFirst;
    let markFirstEntered;
    const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
    const firstEntered = new Promise((resolve) => { markFirstEntered = resolve; });
    let calls = 0;

    mocks.getProviderConnections.mockImplementation(async ({ provider }) => {
      calls += 1;
      if (calls === 1) {
        markFirstEntered();
        await firstGate;
      }
      return [connection(provider)];
    });

    const first = getProviderCredentials("openai");
    await firstEntered;
    const second = getProviderCredentials("openai");
    await Promise.resolve();

    expect(mocks.getProviderConnections).toHaveBeenCalledTimes(1);
    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(mocks.getProviderConnections).toHaveBeenCalledTimes(2);
  });
});
