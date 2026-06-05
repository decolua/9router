import { describe, it, expect, vi, beforeEach } from "vitest";

const undiciFetch = vi.fn();
vi.mock("undici", () => ({ fetch: (...args) => undiciFetch(...args) }));

describe("testRelay shared helper", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("sends the relay header contract and reports success", async () => {
    undiciFetch.mockResolvedValue({ ok: true, status: 200, statusText: "OK" });
    const { testRelay } = await import("@/lib/network/relayTest");

    const result = await testRelay("https://relay.example.app");

    expect(result).toMatchObject({ ok: true, status: 200, error: null });
    expect(typeof result.elapsedMs).toBe("number");
    const [url, init] = undiciFetch.mock.calls[0];
    expect(url).toBe("https://relay.example.app");
    expect(init.headers["x-relay-target"]).toBe("https://httpbin.org");
    expect(init.headers["x-relay-path"]).toBe("/get");
  });

  it("reports a non-ok status as a failed relay", async () => {
    undiciFetch.mockResolvedValue({ ok: false, status: 404, statusText: "Not Found" });
    const { testRelay } = await import("@/lib/network/relayTest");

    const result = await testRelay("https://relay.example.app");

    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(result.error).toBe("Relay returned 404");
  });

  it("maps abort to a timeout message", async () => {
    undiciFetch.mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }));
    const { testRelay } = await import("@/lib/network/relayTest");

    const result = await testRelay("https://relay.example.app", { timeoutMs: 5 });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Relay test timed out");
  });

  it("maps network errors to the error message", async () => {
    undiciFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    const { testRelay } = await import("@/lib/network/relayTest");

    const result = await testRelay("https://relay.example.app");

    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    expect(result.error).toBe("ECONNREFUSED");
  });
});
