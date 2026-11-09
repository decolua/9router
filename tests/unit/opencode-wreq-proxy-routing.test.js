// wreq-js owns its own TCP+TLS layer (TLS impersonation), so it cannot ride an
// undici dispatcher. This suite pins the three-way wiring that makes a Proxy
// Pool selection actually carry the connection:
//
//   1. opencodeTlsClient: session cache keyed by proxy URL (a wreq-js session
//      pins its proxy at creation — "Session proxy cannot be changed after
//      creation" — so one shared session would silently keep the OLD tunnel).
//   2. proxyFetch: the resolved proxy URL is passed to the directFetch adapter
//      instead of the adapter being bypassed for an undici ProxyAgent.
//   3. opencode executor: forwards the proxy URL it is handed.
//
// Regression class: "the pool is configured, a proxy was selected, and the
// request still left through the server's direct interface" — configuration
// without transport participation.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { createSessionMock, loadRuntimeDepMock, makeSession } = vi.hoisted(() => ({
  createSessionMock: vi.fn(),
  loadRuntimeDepMock: vi.fn(),
  makeSession: (fetchImpl) => ({ fetch: fetchImpl, close: vi.fn() }),
}));

vi.mock("../../open-sse/services/lazyRuntime.js", () => ({
  loadRuntimeDep: loadRuntimeDepMock,
}));

beforeEach(async () => {
  vi.resetModules();
  createSessionMock.mockReset();
  loadRuntimeDepMock.mockReset();
  loadRuntimeDepMock.mockResolvedValue({ createSession: createSessionMock });
});

describe("opencodeTlsClient proxy-aware sessions", () => {
  it("passes the proxy URL to wreq-js createSession", async () => {
    createSessionMock.mockResolvedValue(makeSession(vi.fn().mockResolvedValue(new Response("ok", { status: 200 }))));

    const { opencodeTlsFetch, __test__ } = await import("../../open-sse/services/opencodeTlsClient.js");
    await opencodeTlsFetch("https://opencode.ai/inference/v1/chat/completions", { method: "POST", body: "{}" },
      { proxyUrl: "socks5://127.0.0.1:9050" });

    expect(createSessionMock).toHaveBeenCalledTimes(1);
    expect(createSessionMock.mock.calls[0][0].proxy).toBe("socks5://127.0.0.1:9050");
    // TLS impersonation is preserved alongside the proxy, not traded for it.
    expect(__test__.OPENCODE_CIPHER_LIST.split(":")).toHaveLength(17);
  });

  it("omits the proxy field entirely on the direct path", async () => {
    createSessionMock.mockResolvedValue(makeSession(vi.fn().mockResolvedValue(new Response("ok", { status: 200 }))));

    const { opencodeTlsFetch } = await import("../../open-sse/services/opencodeTlsClient.js");
    await opencodeTlsFetch("https://opencode.ai/a", {});

    expect(createSessionMock).toHaveBeenCalledTimes(1);
    expect(createSessionMock.mock.calls[0][0].proxy).toBeUndefined();
  });

  it("builds a distinct session per proxy URL and reuses it per key", async () => {
    const fetchA = vi.fn().mockResolvedValue(new Response("a", { status: 200 }));
    const fetchB = vi.fn().mockResolvedValue(new Response("b", { status: 200 }));
    createSessionMock
      .mockResolvedValueOnce(makeSession(fetchA))
      .mockResolvedValueOnce(makeSession(fetchB));

    const { opencodeTlsFetch, __test__ } = await import("../../open-sse/services/opencodeTlsClient.js");
    await opencodeTlsFetch("https://opencode.ai/1", {}, { proxyUrl: "socks5://127.0.0.1:9050" });
    await opencodeTlsFetch("https://opencode.ai/2", {}, { proxyUrl: "socks5://127.0.0.1:9050" });
    await opencodeTlsFetch("https://opencode.ai/3", {}, { proxyUrl: "http://127.0.0.1:7890" });

    // Two proxy identities -> two sessions; the second request reused the first.
    expect(createSessionMock).toHaveBeenCalledTimes(2);
    expect(__test__.sessionsByProxy.size).toBe(2);
    expect(fetchA).toHaveBeenCalledTimes(2);
    expect(fetchB).toHaveBeenCalledTimes(1);
  });

  it("never reuses the old tunnel after a proxy change (fail-closed rotation)", async () => {
    const oldFetch = vi.fn().mockResolvedValue(new Response("old", { status: 200 }));
    const newFetch = vi.fn().mockResolvedValue(new Response("new", { status: 200 }));
    createSessionMock
      .mockResolvedValueOnce(makeSession(oldFetch))
      .mockResolvedValueOnce(makeSession(newFetch));

    const { opencodeTlsFetch } = await import("../../open-sse/services/opencodeTlsClient.js");
    await opencodeTlsFetch("https://opencode.ai/1", {}, { proxyUrl: "socks5://127.0.0.1:9050" });
    await opencodeTlsFetch("https://opencode.ai/2", {}, { proxyUrl: "socks5://127.0.0.1:9150" });

    expect(oldFetch).toHaveBeenCalledTimes(1); // not reused for the new proxy
    expect(newFetch).toHaveBeenCalledTimes(1);
  });

  it("strips credentials from the proxy identity key", async () => {
    const { __test__ } = await import("../../open-sse/services/opencodeTlsClient.js");
    expect(__test__.normalizeProxyKey("socks5://user:p%40ss@127.0.0.1:9050")).toBe("socks5://127.0.0.1:9050");
    expect(__test__.normalizeProxyKey("http://u:p@10.0.0.1:8080")).toBe("http://10.0.0.1:8080");
    expect(__test__.normalizeProxyKey("")).toBe("");
    expect(__test__.normalizeProxyKey(undefined)).toBe("");
  });

  it("tags the response with transport-level proof when a proxy carried it", async () => {
    createSessionMock.mockResolvedValue(makeSession(vi.fn().mockResolvedValue(new Response("ok", { status: 200 }))));

    const { opencodeTlsFetch } = await import("../../open-sse/services/opencodeTlsClient.js");
    const proxied = await opencodeTlsFetch("https://opencode.ai/a", {}, { proxyUrl: "socks5://u:p@127.0.0.1:9050" });
    expect(proxied.headers.get("x-9r-proxy-via")).toBe("socks5://127.0.0.1:9050");

    const direct = await opencodeTlsFetch("https://opencode.ai/a", {});
    expect(direct.headers.has("x-9r-proxy-via")).toBe(false);
  });

  it("drops the cached session on failure so the next call rebuilds", async () => {
    createSessionMock
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(makeSession(vi.fn().mockResolvedValue(new Response("ok", { status: 200 }))));

    const { opencodeTlsFetch, __test__ } = await import("../../open-sse/services/opencodeTlsClient.js");
    await expect(opencodeTlsFetch("https://opencode.ai/a", {}, { proxyUrl: "http://127.0.0.1:7890" })).rejects.toThrow();
    expect(__test__.sessionsByProxy.size).toBe(0);
    await opencodeTlsFetch("https://opencode.ai/a", {}, { proxyUrl: "http://127.0.0.1:7890" });
    expect(createSessionMock).toHaveBeenCalledTimes(2);
  });
});

describe("proxyAwareFetch delegates the proxy to the transport adapter", () => {
  it("hands the resolved proxy URL to directFetch instead of bypassing it", async () => {
    const adapter = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");

    await proxyAwareFetch("https://opencode.ai/inference/v1/chat/completions", {
      method: "POST",
      body: "{}",
      directFetch: adapter,
    }, { connectionProxyEnabled: true, connectionProxyUrl: "socks5://127.0.0.1:9050" });

    expect(adapter).toHaveBeenCalledTimes(1);
    // Third argument is the resolved proxy URL the adapter must tunnel through.
    expect(adapter.mock.calls[0][2]).toBe("socks5://127.0.0.1:9050");
    expect(adapter.mock.calls[0][1].proxyUrl).toBe("socks5://127.0.0.1:9050");
  });

  it("respects no_proxy by not tunnelling an excluded host", async () => {
    const adapter = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");

    const res = await proxyAwareFetch("https://intranet.local/api", { directFetch: adapter },
      { connectionProxyEnabled: true, connectionProxyUrl: "socks5://127.0.0.1:9050", connectionNoProxy: "intranet.local" });

    // The proxy is excluded, so the adapter still carries the request — but
    // WITHOUT a proxy URL: no_proxy must not become a direct-undici bypass.
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(adapter.mock.calls[0][2]).toBeUndefined();
    expect(res.status).toBe(200);
  });

  it("uses the direct (adapter) path unchanged when no proxy is configured", async () => {
    const adapter = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");

    await proxyAwareFetch("https://opencode.ai/a", { directFetch: adapter });

    expect(adapter).toHaveBeenCalledTimes(1);
    expect(adapter.mock.calls[0][2]).toBeUndefined();
  });

  it("fail-closed: strictProxy surfaces the adapter failure instead of falling back to direct", async () => {
    const adapter = vi.fn().mockRejectedValue(new Error("proxy tunnel refused"));
    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");

    await expect(proxyAwareFetch("https://opencode.ai/a", { directFetch: adapter },
      { connectionProxyEnabled: true, connectionProxyUrl: "socks5://127.0.0.1:9050", strictProxy: true }))
      .rejects.toThrow(/strictProxy=true/);
  });
});
