import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  CLOUDFLARE_CROSS_ZONE_WORKER_IP,
  resolveTrustedClientIp,
} = require("../../client-ip.js");

describe("trusted client IP resolution", () => {
  it("ignores forwarding headers on direct public sockets", () => {
    expect(resolveTrustedClientIp({
      socketIp: "203.0.113.20",
      headers: { "x-forwarded-for": "198.51.100.77" },
    })).toEqual({ ip: "203.0.113.20", source: "socket", viaProxy: false });
  });

  it("uses CF-Connecting-IP for raw Quick Tunnel requests", () => {
    expect(resolveTrustedClientIp({
      socketIp: "127.0.0.1",
      headers: {
        "cf-connecting-ip": "203.0.113.20",
        "x-forwarded-for": "198.51.100.77, 203.0.113.20",
      },
    })).toEqual({ ip: "203.0.113.20", source: "cloudflare", viaProxy: true });
  });

  it("uses validated original IP from short-link Worker chain", () => {
    expect(resolveTrustedClientIp({
      socketIp: "::ffff:127.0.0.1",
      headers: {
        "cf-connecting-ip": CLOUDFLARE_CROSS_ZONE_WORKER_IP,
        "x-forwarded-for": `203.0.113.20, ${CLOUDFLARE_CROSS_ZONE_WORKER_IP}`,
      },
    })).toEqual({ ip: "203.0.113.20", source: "cloudflare-worker", viaProxy: true });
  });

  it("rejects malformed cross-zone Worker chains", () => {
    expect(resolveTrustedClientIp({
      socketIp: "127.0.0.1",
      headers: {
        "cf-connecting-ip": CLOUDFLARE_CROSS_ZONE_WORKER_IP,
        "x-forwarded-for": "198.51.100.77, 203.0.113.20, 2a06:98c0:3600::104",
      },
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
    })).toEqual({ ip: "203.0.113.20", source: "reverse-proxy", viaProxy: true });
  });
});
