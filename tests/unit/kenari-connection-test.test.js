import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  testProxyUrl: vi.fn(),
  proxyAwareFetch: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
  updateProviderConnection: mocks.updateProviderConnection,
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
}));
vi.mock("@/lib/network/proxyTest", () => ({ testProxyUrl: mocks.testProxyUrl }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: mocks.proxyAwareFetch }));

const { testSingleConnection } = await import("../../src/app/api/providers/[id]/test/testUtils.js");

const connection = {
  id: "kenari-connection",
  provider: "kenari",
  authType: "apikey",
  apiKey: "test-kenari-key",
  providerSpecificData: { proxyPoolId: "test-pool" },
};
let fetchMock;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getProviderConnectionById.mockResolvedValue({ ...connection });
  mocks.resolveConnectionProxyConfig.mockResolvedValue({});
  mocks.testProxyUrl.mockResolvedValue({ ok: true });
  fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("Kenari API-key connection test", () => {
  it("validates and persists an active connection when GET succeeds", async () => {
    // Given: a stored API-key connection and a successful upstream response.
    // When
    const result = await testSingleConnection(connection.id);
    // Then
    expect(result).toMatchObject({ valid: true, error: null, refreshed: false });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0];
    const request = new Request(url, options);
    expect(request.url).toBe("https://kenari.id/v1/models");
    expect(request.method).toBe("GET");
    expect(request.headers.get("Authorization")).toBe(`Bearer ${connection.apiKey}`);
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith(connection.id, {
      testStatus: "active", lastError: null, lastErrorAt: null,
    });
  });

  it.each([401, 403])("rejects the key when upstream returns %s", async (status) => {
    // Given
    fetchMock.mockResolvedValue(new Response(null, { status }));
    // When
    const result = await testSingleConnection(connection.id);
    // Then
    expect(result).toMatchObject({ valid: false, error: "Invalid API key" });
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith(connection.id, {
      testStatus: "error", lastError: "Invalid API key", lastErrorAt: expect.any(String),
    });
  });

  it("returns the existing error when the network throws", async () => {
    // Given
    fetchMock.mockRejectedValue(new Error("Network unavailable"));
    // When
    const result = await testSingleConnection(connection.id);
    // Then
    expect(result).toMatchObject({ valid: false, error: "Network unavailable" });
  });

  it.each([
    { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.example:8080", connectionNoProxy: "localhost" },
    { vercelRelayUrl: "https://relay.example" },
  ])("forwards the resolved proxy configuration %j", async (proxy) => {
    // Given
    mocks.resolveConnectionProxyConfig.mockResolvedValue(proxy);
    mocks.proxyAwareFetch.mockResolvedValue(new Response(null, { status: 200 }));
    // When
    const result = await testSingleConnection(connection.id);
    // Then
    expect(result.valid).toBe(true);
    expect(mocks.resolveConnectionProxyConfig).toHaveBeenCalledWith(connection.providerSpecificData);
    expect(mocks.proxyAwareFetch).toHaveBeenCalledWith(
      "https://kenari.id/v1/models",
      expect.objectContaining({ headers: { Authorization: `Bearer ${connection.apiKey}` } }),
      proxy,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["deepseek", "https://api.deepseek.com/models"],
    ["groq", "https://api.groq.com/openai/v1/models"],
  ])("preserves the simple GET probe for %s", async (provider, url) => {
    // Given
    mocks.getProviderConnectionById.mockResolvedValue({ ...connection, provider });
    // When
    const result = await testSingleConnection(connection.id);
    // Then
    expect(result).toMatchObject({ valid: true, error: null });
    expect(fetchMock).toHaveBeenCalledWith(url, expect.objectContaining({
      headers: { Authorization: `Bearer ${connection.apiKey}` },
    }));
  });

  it("keeps unknown providers unsupported", async () => {
    // Given
    mocks.getProviderConnectionById.mockResolvedValue({ ...connection, provider: "unknown-provider" });
    // When
    const result = await testSingleConnection(connection.id);
    // Then
    expect(result).toMatchObject({ valid: false, error: "Provider test not supported" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
