import { beforeEach, describe, expect, it, vi } from "vitest";

const originalFetch = vi.fn();
const proxyAgentConstructor = vi.fn();
const agentConstructor = vi.fn();
const socksCreateConnection = vi.fn();

vi.mock("undici", () => ({
  ProxyAgent: proxyAgentConstructor,
  Agent: agentConstructor,
}));

vi.mock("socks", () => ({
  SocksClient: {
    createConnection: socksCreateConnection,
  },
}));

describe("proxyAwareFetch dispatcher selection", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal("fetch", originalFetch);
    originalFetch.mockResolvedValue({ ok: true, status: 200 });
    proxyAgentConstructor.mockImplementation(function ProxyAgent(options) {
      return { kind: "http", options };
    });
    agentConstructor.mockImplementation(function Agent(options) {
      return { kind: "socks", options };
    });
  });

  it.each(["http://127.0.0.1:8080", "https://127.0.0.1:8443"])(
    "uses undici ProxyAgent for %s",
    async (proxyUrl) => {
      const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");

      await proxyAwareFetch("https://example.com/test", {}, {
        enabled: true,
        url: proxyUrl,
      });

      expect(proxyAgentConstructor).toHaveBeenCalledWith({ uri: proxyUrl });
      expect(agentConstructor).not.toHaveBeenCalled();
      expect(originalFetch).toHaveBeenCalledWith(
        "https://example.com/test",
        expect.objectContaining({ dispatcher: expect.objectContaining({ kind: "http" }) })
      );
    }
  );

  it.each(["socks5://127.0.0.1:40000", "socks5h://127.0.0.1:40000"])(
    "uses a SOCKS-compatible undici Agent for %s",
    async (proxyUrl) => {
      const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");

      await proxyAwareFetch("https://example.com/test", {}, {
        enabled: true,
        url: proxyUrl,
      });

      expect(agentConstructor).toHaveBeenCalledTimes(1);
      expect(agentConstructor).toHaveBeenCalledWith({ connect: expect.any(Function) });
      expect(proxyAgentConstructor).not.toHaveBeenCalled();
      expect(originalFetch).toHaveBeenCalledWith(
        "https://example.com/test",
        expect.objectContaining({ dispatcher: expect.objectContaining({ kind: "socks" }) })
      );
    }
  );

  it("never falls back to direct when strictProxy=true", async () => {
    proxyAgentConstructor.mockImplementation(function ProxyAgent() {
      throw new Error("proxy unavailable");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");

    await expect(proxyAwareFetch("https://example.com/test", {}, {
      enabled: true,
      url: "http://127.0.0.1:8080",
      strictProxy: true,
    })).rejects.toThrow("Proxy required but failed (strictProxy=true): proxy unavailable");

    expect(originalFetch).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("falling back to direct"));
    warn.mockRestore();
  });

  it.each([
    ["caller timeout", new DOMException("The operation was aborted due to timeout", "TimeoutError")],
    ["caller abort", new DOMException("This operation was aborted", "AbortError")],
    ["custom abort reason", new Error("fetch connect timeout")],
  ])("propagates %s without direct fallback", async (_label, abortReason) => {
    const controller = new AbortController();
    controller.abort(abortReason);
    originalFetch.mockRejectedValueOnce(abortReason);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");

    await expect(proxyAwareFetch("https://example.com/test", {
      signal: controller.signal,
    }, {
      enabled: true,
      url: "http://127.0.0.1:8080",
    })).rejects.toBe(abortReason);

    expect(originalFetch).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("Proxy failed"));
    warn.mockRestore();
  });

  it("propagates caller abort under strictProxy without rewriting as proxy failure", async () => {
    const abortReason = new DOMException("This operation was aborted", "AbortError");
    const controller = new AbortController();
    controller.abort(abortReason);
    originalFetch.mockRejectedValueOnce(abortReason);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");

    await expect(proxyAwareFetch("https://example.com/test", {
      signal: controller.signal,
    }, {
      enabled: true,
      url: "http://127.0.0.1:8080",
      strictProxy: true,
    })).rejects.toBe(abortReason);

    expect(originalFetch).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("falls back directly for a genuine proxy transport failure when non-strict", async () => {
    const proxyError = Object.assign(new Error("proxy refused"), { code: "ECONNREFUSED" });
    const directResponse = { ok: true, status: 200 };
    const controller = new AbortController();
    originalFetch.mockRejectedValueOnce(proxyError).mockResolvedValueOnce(directResponse);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");

    await expect(proxyAwareFetch("https://example.com/test", {
      signal: controller.signal,
    }, {
      enabled: true,
      url: "http://127.0.0.1:8080",
    })).resolves.toBe(directResponse);

    expect(controller.signal.aborted).toBe(false);
    expect(originalFetch).toHaveBeenCalledTimes(2);
    expect(originalFetch.mock.calls[1]).toEqual([
      "https://example.com/test",
      { signal: controller.signal },
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("falling back to direct"));
    warn.mockRestore();
  });

  it("propagates caller abort from the MITM bypass path without direct bypass", async () => {
    const abortReason = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    const controller = new AbortController();
    controller.abort(abortReason);
    originalFetch.mockRejectedValueOnce(abortReason);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");

    await expect(proxyAwareFetch("https://cloudcode-pa.googleapis.com/test", {
      signal: controller.signal,
    }, {
      enabled: true,
      url: "http://127.0.0.1:8080",
    })).rejects.toBe(abortReason);

    expect(originalFetch).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("Proxy failed"));
    warn.mockRestore();
  });
});
