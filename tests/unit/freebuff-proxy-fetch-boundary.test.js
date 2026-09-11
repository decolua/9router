import { afterEach, describe, expect, it, vi } from "vitest";

const nativeFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = nativeFetch;
  vi.resetModules();
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
