import { describe, it, expect, vi, beforeEach } from "vitest";

const undiciFetch = vi.fn();
const close = vi.fn();
const destroy = vi.fn();

vi.mock("undici", () => ({
  fetch: undiciFetch,
  ProxyAgent: vi.fn(function ProxyAgent() {
    return { close, destroy };
  }),
}));

describe("testProxyUrl", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    close.mockResolvedValue(undefined);
    destroy.mockResolvedValue(undefined);
  });

  it("destroys the dispatcher instead of awaiting graceful close after a timeout", async () => {
    vi.useFakeTimers();

    undiciFetch.mockImplementation((_url, { signal } = {}) => new Promise((_, reject) => {
      signal?.addEventListener("abort", () => {
        reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }));
      });
    }));

    const { testProxyUrl } = await import("@/lib/network/proxyTest");
    const resultPromise = testProxyUrl({
      proxyUrl: "socks5://127.0.0.1:1080",
      timeoutMs: 100,
    });

    await vi.advanceTimersByTimeAsync(100);
    const result = await resultPromise;

    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: "Proxy test timed out",
    });
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});
