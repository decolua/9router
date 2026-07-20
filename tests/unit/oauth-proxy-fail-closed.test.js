import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProxyPoolById: vi.fn(),
}));

vi.mock("@/models", () => ({
  getProxyPoolById: mocks.getProxyPoolById,
}));

import { resolveConnectionProxyConfig } from "../../src/lib/network/connectionProxy.js";
import { proxyOptionsForPool } from "../../src/lib/oauth/proxyOptions.js";

const originalFetch = globalThis.fetch;

describe("explicit OAuth proxy routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProxyPoolById.mockResolvedValue({
      id: "pool-1",
      isActive: true,
      proxyUrl: "proxy.test:8080",
      noProxy: "*",
      strictProxy: false,
      type: "http",
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.doUnmock("undici");
    vi.resetModules();
  });

  it("normalizes host:port and forces fail-closed pool options", async () => {
    const resolved = await resolveConnectionProxyConfig({ proxyPoolId: "pool-1" });

    expect(resolved).toMatchObject({
      source: "pool",
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy.test:8080",
      connectionNoProxy: "",
      strictProxy: true,
      disableEnvProxy: true,
    });
  });

  it("normalizes every explicit OAuth pool route", async () => {
    await expect(proxyOptionsForPool("pool-1")).resolves.toMatchObject({
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy.test:8080",
      connectionNoProxy: "",
      strictProxy: true,
      disableEnvProxy: true,
    });
  });

  it("keeps Direct explicit and disables ambient proxy", async () => {
    await expect(proxyOptionsForPool("")).resolves.toEqual({ disableEnvProxy: true });
    await expect(proxyOptionsForPool("__none__")).resolves.toEqual({ disableEnvProxy: true });
    expect(mocks.getProxyPoolById).not.toHaveBeenCalled();
  });

  it("does not bypass selected proxy through pool noProxy or retry direct", async () => {
    const directFetch = vi.fn().mockRejectedValue(new Error("proxy unavailable"));
    globalThis.fetch = directFetch;
    vi.doMock("undici", () => ({ ProxyAgent: class ProxyAgent {} }));
    vi.resetModules();
    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
    const proxyOptions = await proxyOptionsForPool("pool-1");

    await expect(proxyAwareFetch("https://provider.test/token", {}, proxyOptions))
      .rejects.toThrow(/proxy required but failed/i);
    expect(directFetch).toHaveBeenCalledTimes(1);
    expect(directFetch.mock.calls[0][1].dispatcher).toBeDefined();
  });

  it("does not attach ambient proxy dispatch for Direct", async () => {
    process.env.HTTPS_PROXY = "http://ambient.test:3128";
    const directFetch = vi.fn().mockResolvedValue(new Response("ok"));
    globalThis.fetch = directFetch;
    vi.resetModules();
    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");

    await proxyAwareFetch("https://provider.test/token", {}, { disableEnvProxy: true });

    expect(directFetch).toHaveBeenCalledTimes(1);
    expect(directFetch.mock.calls[0][1]?.dispatcher).toBeUndefined();
    delete process.env.HTTPS_PROXY;
  });
});
