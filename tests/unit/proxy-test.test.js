import { describe, it, expect, vi, beforeEach } from "vitest";

const undiciFetch = vi.fn();
const createProxyDispatcher = vi.fn();
const disposeProxyDispatcher = vi.fn();

vi.mock("undici", () => ({
  fetch: undiciFetch,
}));

vi.mock("@/lib/network/proxyDispatcher", () => ({
  createProxyDispatcher,
  disposeProxyDispatcher,
}));

describe("testProxyUrl", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    createProxyDispatcher.mockResolvedValue({ id: "dispatcher" });
  });

  it("routes SOCKS through the shared dispatcher and disposes it", async () => {
    undiciFetch.mockResolvedValue({ ok: true, status: 200, statusText: "OK" });
    const { testProxyUrl } = await import("@/lib/network/proxyTest");
    const result = await testProxyUrl({
      proxyUrl: "socks5h://127.0.0.1:40000",
      timeoutMs: 1000,
    });

    expect(createProxyDispatcher).toHaveBeenCalledWith("socks5h://127.0.0.1:40000");
    expect(undiciFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ dispatcher: { id: "dispatcher" } }),
    );
    expect(disposeProxyDispatcher).toHaveBeenCalledWith({ id: "dispatcher" });
    expect(result.ok).toBe(true);
  });

  it("returns a sanitized 400 for unsupported proxy protocols", async () => {
    createProxyDispatcher.mockRejectedValue(new Error("Unsupported proxy protocol: ftp:"));
    const { testProxyUrl } = await import("@/lib/network/proxyTest");
    const result = await testProxyUrl({ proxyUrl: "ftp://example.com" });
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: expect.stringContaining("Unsupported proxy protocol"),
    });
    expect(disposeProxyDispatcher).not.toHaveBeenCalled();
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
    expect(disposeProxyDispatcher).toHaveBeenCalledTimes(1);
    expect(disposeProxyDispatcher).toHaveBeenCalledWith({ id: "dispatcher" });

    vi.useRealTimers();
  });
});
