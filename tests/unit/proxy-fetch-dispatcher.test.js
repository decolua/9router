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

  it("times out a hung proxy attempt and falls back when non-strict", async () => {
    const controller = new AbortController();
    const directResponse = { ok: true, status: 200 };
    originalFetch
      .mockImplementationOnce((_url, opts) => new Promise((_resolve, reject) => {
        const onAbort = () => {
          reject(opts.signal.reason || new DOMException("The operation was aborted", "AbortError"));
        };
        if (opts.signal?.aborted) onAbort();
        else opts.signal?.addEventListener("abort", onAbort, { once: true });
      }))
      .mockResolvedValueOnce(directResponse);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");

    await expect(proxyAwareFetch("https://example.com/test", {
      signal: controller.signal,
    }, {
      enabled: true,
      url: "http://127.0.0.1:8080",
      proxyAttemptTimeoutMs: 30,
    })).resolves.toBe(directResponse);

    expect(controller.signal.aborted).toBe(false);
    expect(originalFetch).toHaveBeenCalledTimes(2);
    expect(originalFetch.mock.calls[0][1].signal).not.toBe(controller.signal);
    expect(originalFetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(originalFetch.mock.calls[1]).toEqual([
      "https://example.com/test",
      { signal: controller.signal },
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("falling back to direct"));
    warn.mockRestore();
  });

  it("fails closed on proxy-attempt timeout when strictProxy=true", async () => {
    originalFetch.mockImplementationOnce((_url, opts) => new Promise((_resolve, reject) => {
      const onAbort = () => {
        reject(opts.signal.reason || new DOMException("The operation was aborted", "AbortError"));
      };
      if (opts.signal?.aborted) onAbort();
      else opts.signal?.addEventListener("abort", onAbort, { once: true });
    }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");

    await expect(proxyAwareFetch("https://example.com/test", {}, {
      enabled: true,
      url: "http://127.0.0.1:8080",
      strictProxy: true,
      proxyAttemptTimeoutMs: 30,
    })).rejects.toThrow("Proxy required but failed (strictProxy=true)");

    expect(originalFetch).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("falling back"));
    warn.mockRestore();
  });

  it("times out a hung MITM proxy attempt before entering direct bypass", async () => {
    const controller = new AbortController();
    originalFetch.mockImplementationOnce((_url, opts) => new Promise((_resolve, reject) => {
      const onAbort = () => {
        reject(opts.signal.reason || new DOMException("The operation was aborted", "AbortError"));
      };
      if (opts.signal?.aborted) onAbort();
      else opts.signal?.addEventListener("abort", onAbort, { once: true });
    }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");

    const response = await proxyAwareFetch("https://cloudcode-pa.googleapis.com/test", {
      signal: controller.signal,
    }, {
      enabled: true,
      url: "http://127.0.0.1:8080",
      proxyAttemptTimeoutMs: 30,
    });

    expect(controller.signal.aborted).toBe(false);
    expect(originalFetch).toHaveBeenCalledTimes(1);
    expect(response).toBeDefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("falling back to direct bypass"));
    warn.mockRestore();
  });

  it("keeps caller abort authoritative over proxy-attempt timeout", async () => {
    const abortReason = new DOMException("This operation was aborted", "AbortError");
    const controller = new AbortController();
    originalFetch.mockImplementationOnce((_url, opts) => new Promise((_resolve, reject) => {
      const onAbort = () => {
        reject(opts.signal.reason || new DOMException("The operation was aborted", "AbortError"));
      };
      if (opts.signal?.aborted) onAbort();
      else opts.signal?.addEventListener("abort", onAbort, { once: true });
    }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");

    const pending = proxyAwareFetch("https://example.com/test", {
      signal: controller.signal,
    }, {
      enabled: true,
      url: "http://127.0.0.1:8080",
      proxyAttemptTimeoutMs: 200,
    });
    await vi.waitFor(() => expect(originalFetch).toHaveBeenCalledTimes(1));
    controller.abort(abortReason);

    await expect(pending).rejects.toBe(abortReason);
    expect(originalFetch).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("Proxy failed"));
    warn.mockRestore();
  });
});
