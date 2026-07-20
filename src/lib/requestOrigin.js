import clientIp from "../../client-ip.js";

const { hasValidRequestProof, isLoopback, normalizeIp } = clientIp;
const TRUSTED_SOURCES = new Set([
  "socket",
  "cloudflare",
  "cloudflare-worker",
  "reverse-proxy",
]);

export function getTrustedRequestOrigin(request) {
  if (!hasValidRequestProof(request?.headers)) return null;
  const ip = normalizeIp(request.headers.get("x-9r-real-ip"));
  if (!ip) return null;
  const source = request.headers.get("x-9r-ip-source") || "unknown";
  return {
    ip,
    source: TRUSTED_SOURCES.has(source) ? source : "unknown",
    viaProxy: request.headers.get("x-9r-via-proxy") === "1",
  };
}

export function isLoopbackAddress(ip) {
  return isLoopback(ip);
}

export function getSafeRequestHeaders(request) {
  return Object.fromEntries(
    [...request.headers.entries()].filter(([name]) => !name.startsWith("x-9r-")),
  );
}
