import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  CLOUDFLARE_CROSS_ZONE_WORKER_IP,
  normalizeIp,
  resolveTrustedClientIp,
} = require("../../client-ip.js");

describe("trusted client IP resolution", () => {
  it("canonicalizes IPv6 and IPv4-mapped IPv6 addresses", () => {
    expect(normalizeIp("2001:0db8:0000:0000:0000:0000:0000:0001")).toBe("2001:db8::1");
    expect(normalizeIp("0:0:0:0:0:ffff:c000:0280")).toBe("192.0.2.128");
  });

  it("ignores forwarding headers on direct public sockets", () => {
    expect(resolveTrustedClientIp({
      socketIp: "203.0.113.20",
      headers: { "x-forwarded-for": "198.51.100.77" },
      trustProxy: true,
    })).toEqual({ ip: "203.0.113.20", source: "socket", viaProxy: false });
  });

  it("fails closed on loopback proxy headers when TRUST_PROXY is disabled", () => {
    expect(resolveTrustedClientIp({
      socketIp: "127.0.0.1",
      headers: { "x-forwarded-for": "198.51.100.77" },
      trustProxy: false,
    })).toEqual({ ip: "127.0.0.1", source: "socket", viaProxy: true });
  });

  it("treats malformed proxy-header presence as proxied on loopback", () => {
    expect(resolveTrustedClientIp({
      socketIp: "127.0.0.1",
      headers: { "x-forwarded-for": "not-an-ip" },
      trustProxy: false,
    })).toEqual({ ip: "127.0.0.1", source: "socket", viaProxy: true });
  });

  it("treats the full IPv4 127/8 range as loopback", () => {
    expect(resolveTrustedClientIp({
      socketIp: "127.0.0.2",
      headers: { "x-forwarded-for": "198.51.100.77" },
      trustProxy: false,
    })).toEqual({ ip: "127.0.0.2", source: "socket", viaProxy: true });
  });

  it("uses CF-Connecting-IP for raw Quick Tunnel requests", () => {
    expect(resolveTrustedClientIp({
      socketIp: "127.0.0.1",
      headers: {
        "cf-connecting-ip": "203.0.113.20",
        "x-forwarded-for": "198.51.100.77, 203.0.113.20",
      },
      trustProxy: true,
    })).toEqual({ ip: "203.0.113.20", source: "cloudflare", viaProxy: true });
  });

  it("uses validated original IP from short-link Worker chain", () => {
    expect(resolveTrustedClientIp({
      socketIp: "::ffff:127.0.0.1",
      headers: {
        "cf-connecting-ip": CLOUDFLARE_CROSS_ZONE_WORKER_IP,
        "x-forwarded-for": `203.0.113.20, ${CLOUDFLARE_CROSS_ZONE_WORKER_IP}`,
      },
      trustProxy: true,
    })).toEqual({ ip: "203.0.113.20", source: "cloudflare-worker", viaProxy: true });
  });

  it("rejects malformed cross-zone Worker chains", () => {
    expect(resolveTrustedClientIp({
      socketIp: "127.0.0.1",
      headers: {
        "cf-connecting-ip": CLOUDFLARE_CROSS_ZONE_WORKER_IP,
        "x-forwarded-for": "198.51.100.77, 203.0.113.20, 2a06:98c0:3600::104",
      },
      trustProxy: true,
    })).toEqual({
      ip: CLOUDFLARE_CROSS_ZONE_WORKER_IP,
      source: "cloudflare",
      viaProxy: true,
    });
  });

  it("uses right-most address from a non-Cloudflare local reverse proxy", () => {
    expect(resolveTrustedClientIp({
      socketIp: "127.0.0.1",
      headers: { "x-forwarded-for": "198.51.100.77, 203.0.113.20" },
      trustProxy: true,
    })).toEqual({ ip: "203.0.113.20", source: "reverse-proxy", viaProxy: true });
  });
});
