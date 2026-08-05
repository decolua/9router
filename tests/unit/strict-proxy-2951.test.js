import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function loadWithFetch(fetchMock) {
  vi.stubGlobal("fetch", fetchMock);
  return import("../../open-sse/utils/proxyFetch.js");
}

describe("strict proxy fail-closed (#2951)", () => {
  it("never calls direct fetch after a strict proxy failure", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("proxy down"));
    const { proxyAwareFetch } = await loadWithFetch(fetchMock);

    await expect(proxyAwareFetch("https://example.com", {}, {
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy.test:8080",
      strictProxy: true,
    })).rejects.toThrow("strictProxy=true");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("preserves direct fallback when strict proxy is disabled", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("proxy down"))
      .mockResolvedValueOnce(new Response("direct"));
    const { proxyAwareFetch } = await loadWithFetch(fetchMock);

    const response = await proxyAwareFetch("https://example.com", {}, {
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy.test:8080",
      strictProxy: false,
    });

    expect(await response.text()).toBe("direct");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
