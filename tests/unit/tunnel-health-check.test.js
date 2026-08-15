import { describe, expect, it, vi } from "vitest";

import { createHealthCheck } from "../../src/lib/tunnel/shared/healthCheck.js";

// Tiny timings so retry/timeout paths run fast in tests.
const FAST = { intervalMs: 5, timeoutMs: 100, fetchTimeoutMs: 100, dnsTimeoutMs: 100 };

function setup({ dnsAlive = true, fetchImpl } = {}) {
  const resolveDns = vi.fn(async () => dnsAlive);
  const fetch = vi.fn(fetchImpl ?? (async () => ({ ok: true })));
  const { probeUrlAlive, waitForHealth } = createHealthCheck(FAST, {
    resolveDns,
    fetch,
  });
  return { resolveDns, fetch, probeUrlAlive, waitForHealth };
}

describe("probeUrlAlive", () => {
  it("returns false for a falsy url and does not probe", async () => {
    const { resolveDns, fetch, probeUrlAlive } = setup();
    await expect(probeUrlAlive("")).resolves.toBe(false);
    await expect(probeUrlAlive(undefined)).resolves.toBe(false);
    await expect(probeUrlAlive(null)).resolves.toBe(false);
    expect(resolveDns).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns false for an unparseable url and does not probe", async () => {
    const { resolveDns, fetch, probeUrlAlive } = setup();
    await expect(probeUrlAlive("not a url")).resolves.toBe(false);
    expect(resolveDns).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns false when DNS resolution fails, without fetching", async () => {
    const { resolveDns, fetch, probeUrlAlive } = setup({ dnsAlive: false });
    await expect(probeUrlAlive("https://example.com")).resolves.toBe(false);
    expect(resolveDns).toHaveBeenCalledWith("example.com", FAST.dnsTimeoutMs);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns false when the fetch request throws", async () => {
    const { probeUrlAlive } = setup({
      fetchImpl: async () => {
        throw new Error("conn refused");
      },
    });
    await expect(probeUrlAlive("https://example.com")).resolves.toBe(false);
  });

  it("returns false when the health response is not ok", async () => {
    const { probeUrlAlive } = setup({ fetchImpl: async () => ({ ok: false }) });
    await expect(probeUrlAlive("https://example.com")).resolves.toBe(false);
  });

  it("probes /api/health with a timeout signal and returns true on ok", async () => {
    const { fetch, probeUrlAlive } = setup();
    await expect(probeUrlAlive("https://example.com")).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://example.com/api/health");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("waitForHealth", () => {
  it("returns true immediately when the first probe succeeds", async () => {
    const { fetch, waitForHealth } = setup();
    await expect(waitForHealth("https://example.com")).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retries until a probe succeeds", async () => {
    const { fetch, waitForHealth } = setup({
      fetchImpl: vi
        .fn()
        .mockResolvedValueOnce({ ok: false })
        .mockResolvedValueOnce({ ok: false })
        .mockResolvedValueOnce({ ok: true }),
    });
    await expect(waitForHealth("https://example.com")).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("throws 'cancelled' when the cancel token is already set", async () => {
    const { waitForHealth } = setup();
    await expect(
      waitForHealth("https://example.com", { cancelled: true })
    ).rejects.toThrow("cancelled");
  });

  it("throws 'cancelled' mid-retry when the token flips", async () => {
    const token = { cancelled: false };
    const { waitForHealth } = setup({
      fetchImpl: async () => {
        token.cancelled = true;
        throw new Error("conn refused");
      },
    });
    await expect(waitForHealth("https://example.com", token)).rejects.toThrow(
      "cancelled"
    );
  });

  it("throws a timeout error when health never becomes alive", async () => {
    const { waitForHealth } = setup({ fetchImpl: async () => ({ ok: false }) });
    await expect(waitForHealth("https://example.com")).rejects.toThrow(
      `Health check timeout after ${FAST.timeoutMs}ms`
    );
  });
});
