// Live network-level verification of the wreq-js proxy integration.
// Proves the request path: proxyAwareFetch -> opencodeTlsFetch -> wreq-js
// session(proxy) -> Tor SOCKS5 -> destination, with a distinct egress IP.
//
// Requires the real wreq-js (node_modules in the repo checkout) and a SOCKS5
// endpoint. Tor on 127.0.0.1:9050 is used when available; otherwise set
// WREQ_PROXY_TEST_SOCKS5 to a socks5 URL. Skipped (not failed) when neither
// is reachable, so this never breaks CI on a sandboxed runner.
import { describe, it, expect } from "vitest";
import net from "node:net";

const SOCKS5 = process.env.WREQ_PROXY_TEST_SOCKS5 || "socks5://127.0.0.1:9050";

function portOpen(host, port, ms = 1500) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => { socket.destroy(); resolve(false); }, ms);
    socket.once("connect", () => { clearTimeout(timer); socket.destroy(); resolve(true); });
    socket.once("error", () => { clearTimeout(timer); resolve(false); });
  });
}

async function directEgress() {
  const r = await fetch("https://check.torproject.org/api/ip", { signal: AbortSignal.timeout(20000) });
  return r.json();
}

const runs = process.env.WREQ_LIVE_PROXY_TESTS === "1";

describe("live wreq-js proxy routing (opt-in)", { skip: !runs }, () => {
  it("exits through the SOCKS5 (Tor) proxy, not the host interface", async () => {
    const host = new URL(SOCKS5).hostname;
    const port = Number(new URL(SOCKS5).port) || 9050;
    expect(await portOpen(host, port)).toBe(true);

    const { opencodeTlsFetch } = await import("../../open-sse/services/opencodeTlsClient.js");
    const res = await opencodeTlsFetch("https://check.torproject.org/api/ip", {}, { proxyUrl: SOCKS5 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.IsTor).toBe(true);

    const direct = await directEgress();
    expect(direct.IsTor).toBe(false);
    // The whole point: the wreq-js request left from a different address.
    expect(body.IP).not.toBe(direct.IP);
  });

  it("headers carry transport-level proof, never credentials", async () => {
    const { opencodeTlsFetch } = await import("../../open-sse/services/opencodeTlsClient.js");
    const res = await opencodeTlsFetch("https://check.torproject.org/api/ip", {},
      { proxyUrl: "socks5://user:p%40ss@127.0.0.1:9050" });
    const via = res.headers.get("x-9r-proxy-via");
    expect(via).toBe("socks5://127.0.0.1:9050");
    expect(via).not.toMatch(/user|p%40ss|password/i);
  });

  it("fails closed when the SOCKS5 endpoint is unreachable", async () => {
    const { opencodeTlsFetch } = await import("../../open-sse/services/opencodeTlsClient.js");
    await expect(opencodeTlsFetch("https://check.torproject.org/api/ip", {},
      { proxyUrl: "socks5://127.0.0.1:1", timeoutMs: 5000 }))
      .rejects.toThrow();
  });
});
