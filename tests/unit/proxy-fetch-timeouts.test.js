import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalFetch = globalThis.fetch;
const originalEnv = {
  connect: process.env.PROXY_CONNECT_TIMEOUT_MS,
  headers: process.env.PROXY_HEADERS_TIMEOUT_MS,
};

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  ProxyAgent: vi.fn(function ProxyAgent(options) {
    this.options = options;
  }),
}));

vi.mock("undici", () => ({ ProxyAgent: mocks.ProxyAgent }));

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function loadProxyFetch() {
  vi.resetModules();
  mocks.fetch.mockReset().mockResolvedValue({ ok: true });
  mocks.ProxyAgent.mockClear();
  globalThis.fetch = mocks.fetch;
  return import("../../open-sse/utils/proxyFetch.js");
}

async function dispatcherOptions(proxyUrl = "http://proxy.example:8080") {
  const { proxyAwareFetch } = await loadProxyFetch();
  await proxyAwareFetch("https://provider.example/v1/models", {}, {
    connectionProxyEnabled: true,
    connectionProxyUrl: proxyUrl,
    strictProxy: true,
  });
  expect(mocks.ProxyAgent).toHaveBeenCalledOnce();
  return mocks.ProxyAgent.mock.calls[0][0];
}

beforeEach(() => {
  delete process.env.PROXY_CONNECT_TIMEOUT_MS;
  delete process.env.PROXY_HEADERS_TIMEOUT_MS;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  restoreEnv("PROXY_CONNECT_TIMEOUT_MS", originalEnv.connect);
  restoreEnv("PROXY_HEADERS_TIMEOUT_MS", originalEnv.headers);
  vi.restoreAllMocks();
});

describe("proxy dispatcher timeouts", () => {
  it("uses stream-safe defaults", async () => {
    await expect(dispatcherOptions()).resolves.toEqual({
      uri: "http://proxy.example:8080",
      connectTimeout: 90_000,
      headersTimeout: 300_000,
      bodyTimeout: 0,
    });
  });

  it("accepts trimmed positive safe-integer overrides", async () => {
    process.env.PROXY_CONNECT_TIMEOUT_MS = " 120000 ";
    process.env.PROXY_HEADERS_TIMEOUT_MS = "600000";

    await expect(dispatcherOptions()).resolves.toMatchObject({
      connectTimeout: 120_000,
      headersTimeout: 600_000,
    });
  });

  it.each(["0", "-1", "1.5", "10junk", "9007199254740992", ""])(
    "rejects invalid timeout override %j",
    async (value) => {
      process.env.PROXY_CONNECT_TIMEOUT_MS = value;
      process.env.PROXY_HEADERS_TIMEOUT_MS = value;

      await expect(dispatcherOptions()).resolves.toMatchObject({
        connectTimeout: 90_000,
        headersTimeout: 300_000,
      });
    },
  );

  it("keeps timeout configuration stable for a cached proxy dispatcher", async () => {
    process.env.PROXY_CONNECT_TIMEOUT_MS = "120000";
    const { proxyAwareFetch } = await loadProxyFetch();
    const proxyOptions = {
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy.example:8080",
      strictProxy: true,
    };

    await proxyAwareFetch("https://provider.example/first", {}, proxyOptions);
    process.env.PROXY_CONNECT_TIMEOUT_MS = "240000";
    await proxyAwareFetch("https://provider.example/second", {}, proxyOptions);

    expect(mocks.ProxyAgent).toHaveBeenCalledOnce();
    expect(mocks.ProxyAgent.mock.calls[0][0].connectTimeout).toBe(120_000);
  });
});
