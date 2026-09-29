import { afterEach, describe, expect, it, vi } from "vitest";

const bypassMocks = vi.hoisted(() => ({
  dnsResolve4: vi.fn((_hostname, callback) => callback(null, ["203.0.113.10"])),
  httpsRequest: vi.fn(),
  socketConnect: vi.fn(),
}));

const DnsResolver = class {
  setServers() {}
  resolve4(hostname, callback) { return bypassMocks.dnsResolve4(hostname, callback); }
};
const HttpsModule = { request: (...args) => bypassMocks.httpsRequest(...args) };
const NetSocket = class {
  connect(...args) { return bypassMocks.socketConnect(this, ...args); }
  on() { return this; }
};
const NetModule = { Socket: NetSocket };

vi.mock("dns", () => ({
  default: { Resolver: DnsResolver },
  Resolver: DnsResolver,
}));

vi.mock("https", () => ({ default: HttpsModule, ...HttpsModule }));
vi.mock("net", () => ({ default: NetModule, ...NetModule }));

const nativeFetch = globalThis.fetch;
const PROXY_ENV_KEYS = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"];

beforeEach(() => {
  for (const key of PROXY_ENV_KEYS) vi.stubEnv(key, "");
});

afterEach(() => {
  globalThis.fetch = nativeFetch;
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("strict proxy boundary", () => {
  it("rejects a strict Codebuff request when connectionNoProxy wildcard would bypass its proxy", async () => {
    const dispatch = vi.fn();
    globalThis.fetch = dispatch;
    vi.resetModules();
    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");

    await expect(proxyAwareFetch("https://api.codebuff.com/v1/chat", {}, {
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy.invalid:8080",
      connectionNoProxy: "*.codebuff.com",
      strictProxy: true,
    })).rejects.toThrow("Proxy required");

    expect(dispatch).not.toHaveBeenCalled();
  });

  it("does not retry direct after a noReplay MITM bypass response loss", async () => {
    const originalFetch = vi.fn().mockResolvedValue(new Response("direct"));
    globalThis.fetch = originalFetch;
    bypassMocks.socketConnect.mockImplementation((socket, _port, _ip, onConnect) => onConnect());
    bypassMocks.httpsRequest.mockImplementation((_options, onResponse) => {
      const request = {
        on: (_event, handler) => {
          if (_event === "error") queueMicrotask(() => handler(new TypeError("response lost")));
          return request;
        },
        write: vi.fn(),
        end: vi.fn(),
      };
      return request;
    });
    vi.resetModules();
    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");

    await expect(proxyAwareFetch("https://api2.cursor.sh/v1/chat", {}, { noReplay: true })).rejects.toThrow("response lost");
    expect(bypassMocks.dnsResolve4).toHaveBeenCalledWith("api2.cursor.sh", expect.any(Function));
    expect(bypassMocks.httpsRequest).toHaveBeenCalledTimes(1);
    expect(originalFetch).not.toHaveBeenCalled();
  });

  it("preserves direct egress for non-strict requests that match connectionNoProxy", async () => {
    const dispatch = vi.fn().mockResolvedValue(new Response("ok"));
    globalThis.fetch = dispatch;
    vi.resetModules();
    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");

    await expect(proxyAwareFetch("https://api.codebuff.com/v1/chat", {}, {
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy.invalid:8080",
      connectionNoProxy: "*.codebuff.com",
    })).resolves.toBeInstanceOf(Response);

    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
