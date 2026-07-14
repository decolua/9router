import { beforeEach, describe, expect, it, vi } from "vitest";

const originalFetch = vi.fn();
const proxyAgentConstructor = vi.fn();
const agentConstructor = vi.fn();

vi.mock("undici", () => ({
  ProxyAgent: proxyAgentConstructor,
  Agent: agentConstructor,
}));

function makeDispatcher(kind, id) {
  return {
    kind,
    id,
    close: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
  };
}

describe("proxy dispatcher lifecycle", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal("fetch", originalFetch);
    originalFetch.mockResolvedValue({ ok: true, status: 200 });

    let seq = 0;
    proxyAgentConstructor.mockImplementation(function ProxyAgent() {
      return makeDispatcher("http", `http-${++seq}`);
    });
    agentConstructor.mockImplementation(function Agent() {
      return makeDispatcher("socks", `socks-${++seq}`);
    });

    const mod = await import("../../open-sse/utils/proxyFetch.js");
    mod.__resetProxyDispatchers();
  });

  it("destroys all cached dispatchers on reset", async () => {
    const { proxyAwareFetch, __resetProxyDispatchers } = await import("../../open-sse/utils/proxyFetch.js");

    await proxyAwareFetch("https://example.com/a", {}, {
      enabled: true,
      url: "http://127.0.0.1:8080",
    });
    await proxyAwareFetch("https://example.com/b", {}, {
      enabled: true,
      url: "socks5h://127.0.0.1:40000",
    });

    const firstHttp = proxyAgentConstructor.mock.results[0].value;
    const firstSocks = agentConstructor.mock.results[0].value;

    __resetProxyDispatchers();

    expect(firstHttp.destroy).toHaveBeenCalledTimes(1);
    expect(firstSocks.destroy).toHaveBeenCalledTimes(1);
  });

  it("destroys the oldest dispatcher when the cache is full", async () => {
    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
    const { MEMORY_CONFIG } = await import("../../open-sse/config/runtimeConfig.js");
    const max = MEMORY_CONFIG.proxyDispatchersMaxSize;

    for (let i = 0; i < max; i += 1) {
      await proxyAwareFetch("https://example.com/fill", {}, {
        enabled: true,
        url: `http://127.0.0.1:${9000 + i}`,
      });
    }

    const oldest = proxyAgentConstructor.mock.results[0].value;
    expect(oldest.destroy).not.toHaveBeenCalled();

    await proxyAwareFetch("https://example.com/overflow", {}, {
      enabled: true,
      url: "http://127.0.0.1:9999",
    });

    expect(oldest.destroy).toHaveBeenCalledTimes(1);
    // newest entry still created after eviction
    expect(proxyAgentConstructor).toHaveBeenCalledTimes(max + 1);
  });
});
