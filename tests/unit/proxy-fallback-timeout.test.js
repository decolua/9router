import { afterEach, describe, expect, it, vi } from "vitest";

const originalFetch = globalThis.fetch;
const originalHttpsProxy = process.env.HTTPS_PROXY;

describe("proxyAwareFetch proxy attempt timeout", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalHttpsProxy === undefined) delete process.env.HTTPS_PROXY;
    else process.env.HTTPS_PROXY = originalHttpsProxy;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("falls back to direct fetch with the caller signal still usable", async () => {
    process.env.HTTPS_PROXY = "http://proxy.test:8080";
    vi.doMock("undici", () => ({
      ProxyAgent: class ProxyAgent {
        constructor(options) { this.options = options; }
      },
    }));

    const fetchMock = vi.fn()
      .mockImplementationOnce((url, options) => new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
      }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    globalThis.fetch = fetchMock;

    vi.resetModules();
    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
    const callerController = new AbortController();
    const response = await proxyAwareFetch("https://opencode.ai/", {
      signal: callerController.signal,
    }, {
      proxyAttemptTimeoutMs: 10,
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].dispatcher).toBeDefined();
    expect(fetchMock.mock.calls[1][1].dispatcher).toBeUndefined();
    expect(fetchMock.mock.calls[1][1].signal).toBe(callerController.signal);
    expect(callerController.signal.aborted).toBe(false);
  });
});
