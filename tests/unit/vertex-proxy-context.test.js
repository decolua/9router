import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  proxyAwareFetch: vi.fn(),
  refreshGoogleToken: vi.fn(),
  refreshVertexToken: vi.fn(),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  normalizeExplicitProxyOptions: (options) => options,
  proxyAwareFetch: mocks.proxyAwareFetch,
}));
vi.mock("../../open-sse/services/tokenRefresh.js", () => ({
  getRefreshLeadMs: () => 300_000,
  isUnrecoverableRefreshError: () => false,
  parseVertexSaJson: (value) => {
    try {
      const parsed = JSON.parse(value);
      return parsed.type === "service_account" ? parsed : null;
    } catch {
      return null;
    }
  },
  refreshGoogleToken: mocks.refreshGoogleToken,
  refreshTokenByProvider: vi.fn(),
  refreshVertexToken: mocks.refreshVertexToken,
}));

import { VertexExecutor } from "../../open-sse/executors/vertex.js";

const originalFetch = globalThis.fetch;
const proxyOptions = {
  connectionProxyEnabled: true,
  connectionProxyUrl: "http://proxy.test:8080",
  connectionNoProxy: "",
  strictProxy: true,
  disableEnvProxy: true,
};
const adc = JSON.stringify({
  type: "authorized_user",
  client_id: "adc-client",
  client_secret: "adc-secret",
  refresh_token: "adc-refresh",
  quota_project_id: "project-1",
});

describe("Vertex proxy context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.refreshGoogleToken.mockResolvedValue({ accessToken: "adc-access" });
    mocks.proxyAwareFetch.mockResolvedValue(new Response("{}", { status: 200 }));
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("passes proxy context into ADC reactive refresh", async () => {
    const executor = new VertexExecutor("vertex");
    const log = { debug: vi.fn() };

    await expect(executor.refreshCredentials({ apiKey: adc }, log, proxyOptions))
      .resolves.toMatchObject({ accessToken: "adc-access" });
    expect(mocks.refreshGoogleToken).toHaveBeenCalledWith(
      "adc-refresh",
      "adc-client",
      "adc-secret",
      log,
      proxyOptions,
    );
  });

  it("passes proxy context into ADC proactive refresh and provider fetch", async () => {
    const executor = new VertexExecutor("vertex");
    const credentials = { apiKey: adc, providerSpecificData: {} };

    await executor.execute({
      model: "gemini-2.5-pro",
      body: { contents: [] },
      stream: false,
      credentials,
      proxyOptions,
    });

    expect(mocks.refreshGoogleToken.mock.calls[0].at(-1)).toBe(proxyOptions);
    expect(mocks.proxyAwareFetch.mock.calls[0].at(-1)).toBe(proxyOptions);
  });

  it("uses proxy context for project discovery and partner provider fetch", async () => {
    mocks.proxyAwareFetch
      .mockResolvedValueOnce({
        json: async () => ({ error: { message: "projects/discovered-project/locations/global" } }),
      })
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const executor = new VertexExecutor("vertex-partner");

    await executor.execute({
      model: "partner-model",
      body: { messages: [] },
      stream: false,
      credentials: { apiKey: "raw-api-key", providerSpecificData: {} },
      proxyOptions,
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(mocks.proxyAwareFetch).toHaveBeenCalledTimes(2);
    expect(mocks.proxyAwareFetch.mock.calls.every((call) => call.at(-1) === proxyOptions)).toBe(true);
  });
});
