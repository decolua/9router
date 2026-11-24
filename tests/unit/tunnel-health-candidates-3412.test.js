/**
 * #3412 (defect 1) — "Health check timeout after 60000ms" reported a tunnel as
 * failed while it was already serving.
 *
 * `enableTunnel()` gated on `waitForHealth(publicUrl)` — the relay only. The
 * direct `*.trycloudflare.com` URL was probed afterwards and only as a
 * best-effort log line, so a relay registration that propagated slower than the
 * 60 s budget failed the whole enable, with no retry and no grace period.
 *
 * The gate now takes candidates in preference order and is satisfied by whichever
 * answers first.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveDns = vi.fn(async () => true);
vi.mock("../../src/lib/tunnel/shared/dnsResolver.js", () => ({ resolveDns }));

const { waitForHealth } = await import("../../src/lib/tunnel/cloudflare/healthCheck.js");
const { HEALTH_CHECK } = await import("../../src/lib/tunnel/cloudflare/config.js");

const RELAY = "https://rabc123.abc-tunnel.us";
const DIRECT = "https://tall-cats-run.trycloudflare.com";

/** Answer /api/health with 200 only for the listed origins. */
function serveHealthy(...aliveOrigins) {
  const attempts = [];
  globalThis.fetch = vi.fn(async (url) => {
    const origin = String(url).replace(/\/api\/health$/, "");
    attempts.push(origin);
    return { ok: aliveOrigins.includes(origin), status: aliveOrigins.includes(origin) ? 200 : 404 };
  });
  return attempts;
}

describe("tunnel health gate accepts either URL (#3412)", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => { resolveDns.mockClear(); });
  afterEach(() => { globalThis.fetch = realFetch; vi.useRealTimers(); });

  it("returns the relay when the relay answers", async () => {
    serveHealthy(RELAY, DIRECT);
    await expect(waitForHealth([RELAY, DIRECT])).resolves.toBe(RELAY);
  });

  it("accepts the direct URL when the relay is not registered yet", async () => {
    const attempts = serveHealthy(DIRECT);

    await expect(waitForHealth([RELAY, DIRECT])).resolves.toBe(DIRECT);
    // The relay keeps its preference: it is still tried first each round.
    expect(attempts[0]).toBe(RELAY);
  });

  it("still accepts a single URL argument", async () => {
    serveHealthy(RELAY);
    await expect(waitForHealth(RELAY)).resolves.toBe(RELAY);
  });

  it("ignores empty candidates and rejects when there are none", async () => {
    serveHealthy(DIRECT);
    await expect(waitForHealth([null, DIRECT, undefined])).resolves.toBe(DIRECT);
    await expect(waitForHealth([null, ""])).rejects.toThrow(/at least one URL/);
  });

  it("times out only when no candidate answers", async () => {
    vi.useFakeTimers();
    serveHealthy();

    const pending = waitForHealth([RELAY, DIRECT]);
    const assertion = expect(pending).rejects.toThrow(
      `Health check timeout after ${HEALTH_CHECK.timeoutMs}ms`,
    );
    await vi.advanceTimersByTimeAsync(HEALTH_CHECK.timeoutMs + HEALTH_CHECK.intervalMs);
    await assertion;
  });

  it("honours the cancel token", async () => {
    serveHealthy();
    await expect(waitForHealth([RELAY, DIRECT], { cancelled: true })).rejects.toThrow("cancelled");
  });

  it("does not probe a host whose DNS does not resolve", async () => {
    resolveDns.mockResolvedValueOnce(false);
    const attempts = serveHealthy(RELAY, DIRECT);

    await expect(waitForHealth([RELAY, DIRECT])).resolves.toBe(DIRECT);
    expect(attempts).toEqual([DIRECT]);
  });
});
