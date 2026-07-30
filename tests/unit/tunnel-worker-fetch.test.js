import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const WORKER = "https://abc-tunnel.us";

describe("tunnel worker fetch (TLS failure)", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    delete process.env.TUNNEL_WORKER_INSECURE;
    vi.resetModules();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.TUNNEL_WORKER_INSECURE;
    delete process.env.TUNNEL_WORKER_URL;
  });

  it("annotates fetch failures with the underlying TLS error code", async () => {
    globalThis.fetch = vi.fn(async () => {
      const e = new Error("fetch failed");
      e.cause = Object.assign(new Error("self-signed certificate in certificate chain"), {
        code: "SELF_SIGNED_CERT_IN_CHAIN",
      });
      throw e;
    });

    const { workerFetch } = await import("../../src/lib/tunnel/cloudflare/workerFetch.js");

    await expect(
      workerFetch(`${WORKER}/api/tunnel/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shortId: "abc123", tunnelUrl: "https://x.trycloudflare.com" }),
      })
    ).rejects.toThrow(/SELF_SIGNED_CERT_IN_CHAIN/);
  });

  it("respects TUNNEL_WORKER_INSECURE=1 by allowing the worker host", async () => {
    process.env.TUNNEL_WORKER_INSECURE = "1";
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200 }));
    const { workerFetch } = await import("../../src/lib/tunnel/cloudflare/workerFetch.js");
    const res = await workerFetch(`${WORKER}/api/health`);
    // The worker TLS handshake must complete (no SELF_SIGNED_CERT_IN_CHAIN).
    // Status code itself is irrelevant — production worker may return 200 or 403.
    expect(res).toBeDefined();
    expect(typeof res.status).toBe("number");
    // insecure path uses https.request, not the global fetch
    expect(globalThis.fetch).not.toHaveBeenCalled();
  }, 15000);

  it("rejects the insecure path for non-worker hosts", async () => {
    process.env.TUNNEL_WORKER_INSECURE = "1";
    const { workerFetch } = await import("../../src/lib/tunnel/cloudflare/workerFetch.js");
    await expect(
      workerFetch("https://example.com/api/health")
    ).rejects.toThrow(/only applies to abc-tunnel\.us/);
  });

  it("parses common truthy values for the insecure flag", async () => {
    process.env.TUNNEL_WORKER_INSECURE = "true";
    const { INSECURE_WORKER } = await import("../../src/lib/tunnel/cloudflare/config.js");
    expect(INSECURE_WORKER).toBe(true);

    process.env.TUNNEL_WORKER_INSECURE = "off";
    vi.resetModules();
    const { INSECURE_WORKER: off } = await import("../../src/lib/tunnel/cloudflare/config.js");
    expect(off).toBe(false);
  });
});

describe("probeUrlAlive uses workerFetch for worker host", () => {
  beforeEach(() => {
    delete process.env.TUNNEL_WORKER_INSECURE;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.TUNNEL_WORKER_INSECURE;
  });

  it("returns false on the worker host when TLS handshake fails", async () => {
    globalThis.fetch = vi.fn(async () => {
      const e = new Error("fetch failed");
      e.cause = Object.assign(new Error("self signed certificate in certificate chain"), {
        code: "SELF_SIGNED_CERT_IN_CHAIN",
      });
      throw e;
    });
    const { probeUrlAlive } = await import("../../src/lib/tunnel/cloudflare/healthCheck.js");
    const alive = await probeUrlAlive("https://rabc123.abc-tunnel.us");
    expect(alive).toBe(false);
  });
});