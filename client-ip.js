const net = require("node:net");

// Cloudflare uses this fixed address for cross-zone Worker subrequests.
const CLOUDFLARE_CROSS_ZONE_WORKER_IP = "2a06:98c0:3600::103";

function headerValue(value) {
  if (Array.isArray(value)) return value[0] || "";
  return typeof value === "string" ? value : "";
}

function normalizeIp(value) {
  let ip = headerValue(value).trim().toLowerCase();
  if (ip.startsWith("[") && ip.endsWith("]")) ip = ip.slice(1, -1);
  if (ip.startsWith("::ffff:") && net.isIP(ip.slice(7)) === 4) ip = ip.slice(7);
  return net.isIP(ip) ? ip : "";
}

function parseForwardedFor(value) {
  return headerValue(value)
    .split(",")
    .map(normalizeIp)
    .filter(Boolean);
}

function isLoopback(ip) {
  return ip === "127.0.0.1" || ip === "::1";
}

function resolveTrustedClientIp({ socketIp, headers = {} }) {
  const peerIp = normalizeIp(socketIp);
  const cfIp = normalizeIp(headers["cf-connecting-ip"]);
  const realIp = normalizeIp(headers["x-real-ip"]);
  const forwarded = parseForwardedFor(headers["x-forwarded-for"]);
  const hasProxyHeaders = Boolean(cfIp || realIp || forwarded.length);

  if (!isLoopback(peerIp) || !hasProxyHeaders) {
    return { ip: peerIp, source: "socket", viaProxy: false };
  }

  if (cfIp) {
    const isCrossZoneWorker = cfIp === CLOUDFLARE_CROSS_ZONE_WORKER_IP;
    const validWorkerChain = forwarded.length === 2
      && forwarded[1] === CLOUDFLARE_CROSS_ZONE_WORKER_IP;

    if (isCrossZoneWorker && validWorkerChain) {
      return { ip: forwarded[0], source: "cloudflare-worker", viaProxy: true };
    }

    return { ip: cfIp, source: "cloudflare", viaProxy: true };
  }

  if (realIp) return { ip: realIp, source: "reverse-proxy", viaProxy: true };
  return {
    ip: forwarded[forwarded.length - 1] || peerIp,
    source: "reverse-proxy",
    viaProxy: true,
  };
}

module.exports = {
  CLOUDFLARE_CROSS_ZONE_WORKER_IP,
  normalizeIp,
  resolveTrustedClientIp,
};
