const crypto = require("node:crypto");
const net = require("node:net");

// Cloudflare uses this fixed address for cross-zone Worker subrequests.
const CLOUDFLARE_CROSS_ZONE_WORKER_IP = "2a06:98c0:3600::103";
const REQUEST_PROOF_ENV = "NINE_ROUTER_REQUEST_PROOF";
const REQUEST_PROOF_HEADER = "x-9r-request-proof";

function headerValue(value) {
  if (Array.isArray(value)) return value[0] || "";
  return typeof value === "string" ? value : "";
}

function getHeader(headers, name) {
  return headers?.get ? headers.get(name) : headers?.[name];
}

function hasHeader(headers, name) {
  return headers?.has
    ? headers.has(name)
    : Object.prototype.hasOwnProperty.call(headers || {}, name);
}

function createRequestProof() {
  return crypto.randomBytes(32).toString("base64url");
}

function hasValidRequestProof(headers) {
  const expected = process.env[REQUEST_PROOF_ENV] || "";
  const supplied = headerValue(getHeader(headers, REQUEST_PROOF_HEADER));
  if (!expected || supplied.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

function normalizeIp(value) {
  let ip = headerValue(value).trim().toLowerCase();
  if (ip.startsWith("[") && ip.endsWith("]")) ip = ip.slice(1, -1);
  if (ip.startsWith("::ffff:") && net.isIP(ip.slice(7)) === 4) ip = ip.slice(7);
  const version = net.isIP(ip);
  if (version === 4) return ip;
  if (version !== 6) return "";

  const canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  const mapped = canonical.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!mapped) return canonical;
  const high = Number.parseInt(mapped[1], 16);
  const low = Number.parseInt(mapped[2], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

function parseForwardedFor(value) {
  return headerValue(value)
    .split(",")
    .map(normalizeIp)
    .filter(Boolean);
}

function isLoopback(ip) {
  return ip === "::1" || ip.startsWith("127.");
}

function resolveTrustedClientIp({ socketIp, headers = {}, trustProxy = false }) {
  const peerIp = normalizeIp(socketIp);
  const cfIp = normalizeIp(headers["cf-connecting-ip"]);
  const realIp = normalizeIp(headers["x-real-ip"]);
  const forwarded = parseForwardedFor(headers["x-forwarded-for"]);
  const hasProxyHeaders = [
    "cf-connecting-ip",
    "x-real-ip",
    "x-forwarded-for",
    "forwarded",
  ].some((name) => hasHeader(headers, name));

  if (!isLoopback(peerIp) || !hasProxyHeaders) {
    return { ip: peerIp, source: "socket", viaProxy: false };
  }

  if (!trustProxy) return { ip: peerIp, source: "socket", viaProxy: true };

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
  REQUEST_PROOF_ENV,
  REQUEST_PROOF_HEADER,
  createRequestProof,
  hasValidRequestProof,
  isLoopback,
  normalizeIp,
  resolveTrustedClientIp,
};
