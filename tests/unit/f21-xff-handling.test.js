// F21'/T1.3-F-6 + F-8: with a loopback reverse proxy the wrapper used to adopt the
// LEFTMOST x-forwarded-for entry — the one the original client controls — which rotated
// loginLimiter buckets and poisoned persisted IPs. Forwarding headers are now honored
// only when the operator declares how many appending proxies to trust
// (TRUSTED_PROXY_HOPS, default 0 = always the socket address), and when trusted the hop
// is counted from the RIGHT (each trusted proxy appends its real peer).
// x-forwarded-host is stripped unconditionally: it feeds OIDC redirect_uri and SAML
// destinations (F-8) and nothing in the trusted path needs it.
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { createRequire } from "node:module";
import http from "node:http";

const require = createRequire(import.meta.url);

let server;
let baseUrl;
let seenHeaders;

beforeAll(async () => {
  require("../../custom-server.js");
  server = http.createServer((req, res) => {
    seenHeaders = req.headers;
    res.end("ok");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

afterEach(() => {
  delete process.env.TRUSTED_PROXY_HOPS;
});

async function get(headers = {}) {
  await fetch(baseUrl, { headers });
  return seenHeaders;
}

describe("TRUSTED_PROXY_HOPS policy (default: trust zero forwarding hops)", () => {
  it("keeps the socket address when a loopback proxy forwards an XFF chain", async () => {
    const headers = await get({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" });

    expect(headers["x-9r-real-ip"]).toMatch(/^(::ffff:)?127\.0\.0\.1$/);
    expect(headers["x-9r-via-proxy"]).toBe("1");
    expect(headers["x-forwarded-for"]).toBeUndefined();
  });

  it("still ignores spoofed x-real-ip without a trusted hop count", async () => {
    const headers = await get({ "x-real-ip": "198.51.100.2" });

    expect(headers["x-9r-real-ip"]).toMatch(/^(::ffff:)?127\.0\.0\.1$/);
  });
});

describe("TRUSTED_PROXY_HOPS=1 (one loopback nginx/caddy appending proxy)", () => {
  it("adopts the LAST hop, not the spoofable first one", async () => {
    process.env.TRUSTED_PROXY_HOPS = "1";

    // Attacker smuggled "203.0.113.9"; the proxy appended the real client 10.0.0.1.
    const headers = await get({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" });

    expect(headers["x-9r-real-ip"]).toBe("10.0.0.1");
  });

  it("adopts the single appended hop when the client sent no XFF", async () => {
    process.env.TRUSTED_PROXY_HOPS = "1";

    const headers = await get({ "x-forwarded-for": "198.51.100.4" });

    expect(headers["x-9r-real-ip"]).toBe("198.51.100.4");
  });

  it("falls back to x-real-ip when no XFF chain exists", async () => {
    process.env.TRUSTED_PROXY_HOPS = "1";

    const headers = await get({ "x-real-ip": "198.51.100.7" });

    expect(headers["x-9r-real-ip"]).toBe("198.51.100.7");
  });

  it("takes the second-from-right hop when two proxies are trusted", async () => {
    process.env.TRUSTED_PROXY_HOPS = "2";

    const headers = await get({ "x-forwarded-for": "attacker-controlled, 198.51.100.7, 10.0.0.2" });

    expect(headers["x-9r-real-ip"]).toBe("198.51.100.7");
  });

  it("clamps to the rightmost available hop when the chain is shorter than configured", async () => {
    process.env.TRUSTED_PROXY_HOPS = "3";

    const headers = await get({ "x-forwarded-for": "198.51.100.7" });

    expect(headers["x-9r-real-ip"]).toBe("198.51.100.7");
  });

  it("ignores a garbage hop count and keeps the socket address", async () => {
    process.env.TRUSTED_PROXY_HOPS = "banana";

    const headers = await get({ "x-forwarded-for": "203.0.113.9" });

    expect(headers["x-9r-real-ip"]).toMatch(/^(::ffff:)?127\.0\.0\.1$/);
  });
});

describe("x-forwarded-host is never forwarded to Next (T1.3-F-8)", () => {
  it("drops it on a plain direct request", async () => {
    const headers = await get({ "x-forwarded-host": "evil.example" });

    expect(headers["x-forwarded-host"]).toBeUndefined();
  });

  it("drops it even when forwarding hops are trusted", async () => {
    process.env.TRUSTED_PROXY_HOPS = "1";

    const headers = await get({
      "x-forwarded-host": "evil.example",
      "x-forwarded-for": "10.0.0.1",
    });

    expect(headers["x-forwarded-host"]).toBeUndefined();
    expect(headers["x-9r-real-ip"]).toBe("10.0.0.1");
  });

  it("keeps x-forwarded-proto (Secure-cookie heuristic is a documented opt-in signal)", async () => {
    const headers = await get({ "x-forwarded-proto": "https" });

    expect(headers["x-forwarded-proto"]).toBe("https");
  });
});
