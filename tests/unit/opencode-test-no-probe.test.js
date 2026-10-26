import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  testProxyUrl: vi.fn(),
  fetchMock: vi.fn(),
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

const { testSingleConnection } = await import(
  "../../src/app/api/providers/[id]/test/testUtils.js"
);

describe("provider test API key connection: opencode free tier probe (#5149)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveConnectionProxyConfig.mockResolvedValue({});
    mocks.testProxyUrl.mockResolvedValue({ ok: true });
    mocks.updateProviderConnection.mockResolvedValue(undefined);
    global.fetch = mocks.fetchMock;
    mocks.fetchMock.mockReset();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("opencode (free provider) returns valid: true without network probe", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-opencode-free",
      provider: "opencode",
      authType: "apikey",
      apiKey: "public",
      providerSpecificData: {},
    });

    const res = await testSingleConnection("conn-opencode-free");

    expect(res).toMatchObject({ valid: true, error: null });
    expect(mocks.fetchMock).not.toHaveBeenCalled();
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith(
      "conn-opencode-free",
      expect.objectContaining({ testStatus: "active", lastError: null })
    );
  });

  it("opencode-go still performs network probe", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-opencode-go",
      provider: "opencode-go",
      authType: "apikey",
      apiKey: "oc_sk_test_key",
      providerSpecificData: {},
    });

    mocks.fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));

    const res = await testSingleConnection("conn-opencode-go");

    expect(res).toMatchObject({ valid: true, error: null });
    expect(mocks.fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = mocks.fetchMock.mock.calls[0];
    expect(url).toBe("https://opencode.ai/zen/go/v1/chat/completions");
    expect(options.method).toBe("POST");
  });
});
