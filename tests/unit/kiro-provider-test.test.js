import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  testProxyUrl: vi.fn(),
  refreshProviderCredentials: vi.fn(),
  shouldRefreshCredentials: vi.fn(),
  resolveKiroModels: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
  updateProviderConnection: mocks.updateProviderConnection,
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
}));

vi.mock("@/lib/network/proxyTest", () => ({
  testProxyUrl: mocks.testProxyUrl,
}));

vi.mock("open-sse/services/oauthCredentialManager.js", () => ({
  refreshProviderCredentials: mocks.refreshProviderCredentials,
  shouldRefreshCredentials: mocks.shouldRefreshCredentials,
}));

vi.mock("open-sse/services/kiroModels.js", () => ({
  resolveKiroModels: mocks.resolveKiroModels,
}));

import { testSingleConnection } from "../../src/app/api/providers/[id]/test/testUtils.js";

describe("Kiro API-key provider test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateProviderConnection.mockResolvedValue(true);
    mocks.resolveConnectionProxyConfig.mockResolvedValue({
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy.test:8080",
      connectionNoProxy: "",
      vercelRelayUrl: "",
    });
    mocks.testProxyUrl.mockResolvedValue({ ok: false, error: "unrelated probe failed" });
    mocks.resolveKiroModels.mockResolvedValue({
      models: [{ id: "claude-opus-5" }],
      rawModels: [{ modelId: "claude-opus-5" }],
    });
  });

  it("validates through Q and clears stale state without a generic proxy probe", async () => {
    const providerSpecificData = {
      authMethod: "api_key",
      region: "eu-central-1",
    };
    const connection = {
      id: "kiro-api-key-test",
      provider: "kiro",
      authType: "api_key",
      accessToken: "kiro-api-key",
      refreshToken: null,
      providerSpecificData,
      errorCode: 400,
      backoffLevel: 2,
      modelLock___all: "2026-08-10T00:00:00.000Z",
      "modelLock_claude-opus-5": "2026-08-10T00:00:00.000Z",
    };
    mocks.getProviderConnectionById.mockResolvedValue(connection);

    const result = await testSingleConnection(connection.id);

    expect(result.valid).toBe(true);
    expect(mocks.testProxyUrl).not.toHaveBeenCalled();
    expect(mocks.resolveKiroModels).toHaveBeenCalledWith(
      {
        accessToken: "kiro-api-key",
        refreshToken: null,
        providerSpecificData,
      },
      expect.objectContaining({ forceRefresh: true }),
    );
    expect(mocks.refreshProviderCredentials).not.toHaveBeenCalled();
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith(
      connection.id,
      expect.objectContaining({
        testStatus: "active",
        lastError: null,
        errorCode: null,
        lastErrorAt: null,
        backoffLevel: 0,
        modelLock___all: null,
        "modelLock_claude-opus-5": null,
      }),
    );
  });
});
