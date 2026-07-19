import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  proxyAwareFetch: vi.fn(),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  normalizeExplicitProxyOptions(proxyOptions) {
    const hasProxy = proxyOptions?.connectionProxyEnabled === true && proxyOptions?.connectionProxyUrl;
    return hasProxy || proxyOptions?.vercelRelayUrl || proxyOptions?.disableEnvProxy === true
      ? proxyOptions
      : { disableEnvProxy: true };
  },
  proxyAwareFetch: mocks.proxyAwareFetch,
}));

import { GeminiCLIExecutor } from "../../open-sse/executors/gemini-cli.js";
import { QwenExecutor } from "../../open-sse/executors/qwen.js";

const originalFetch = globalThis.fetch;

const executors = [
  ["Gemini CLI", () => new GeminiCLIExecutor()],
  ["Qwen", () => new QwenExecutor()],
];

const selectedProxy = {
  connectionProxyEnabled: true,
  connectionProxyUrl: "http://proxy.test:8080",
  connectionNoProxy: "localhost",
  vercelRelayUrl: "",
  strictProxy: true,
};

function tokenResponse() {
  return {
    ok: true,
    json: async () => ({
      access_token: "fresh-access",
      refresh_token: "fresh-refresh",
      expires_in: 3600,
      resource_url: "portal.qwen.ai",
    }),
  };
}

describe("reactive OAuth refresh routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.proxyAwareFetch.mockResolvedValue(tokenResponse());
    globalThis.fetch = vi.fn().mockResolvedValue(tokenResponse());
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it.each(executors)("routes %s refresh through selected proxy", async (_name, createExecutor) => {
    await createExecutor().refreshCredentials({ refreshToken: "refresh-token" }, null, selectedProxy);

    expect(mocks.proxyAwareFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ method: "POST" }),
      selectedProxy,
    );
  });

  it.each(executors)("forces Direct %s refresh to bypass ambient proxy", async (_name, createExecutor) => {
    await createExecutor().refreshCredentials({ refreshToken: "refresh-token" }, null, {
      connectionProxyEnabled: false,
      connectionProxyUrl: "",
      vercelRelayUrl: "",
    });

    expect(mocks.proxyAwareFetch).toHaveBeenCalledTimes(1);
    expect(mocks.proxyAwareFetch.mock.calls[0][2]).toEqual({ disableEnvProxy: true });
  });
});
