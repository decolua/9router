// Trustworthy client-IP derivation.
//
// Ports the logic that used to live in custom-server.js (a monkey-patch over
// Next's standalone HTTP server). Derives the client IP from the TCP socket
// (unspoofable) and strips client-supplied forwarding headers so downstream
// rate-limiting (loginLimiter) and guards (dashboardGuard) key on the real
// peer address instead of attacker-controlled XFF.
//
// x-9r-real-ip   → resolved trustworthy client IP
// x-9r-via-proxy → "1" when the request came through a (loopback) reverse proxy

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/**
 * Mutate a Node IncomingMessage's headers in-place so downstream handlers see
 * sanitized x-9r-* headers. Call this before the framework's request handler
 * reads the headers.
 *
 * In prod this is invoked via server.prependListener("request", ...) on the
 * http.Server that vinext's startProdServer returns (see server.vinext.js).
 * In dev it runs as a connect middleware (see vite.config.ts).
 * @param {import("node:http").IncomingMessage} req
 */
export function injectTrustedClientIp(req) {
  const headers = req.headers;
  if (!headers) return;

  const socketIp = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : "";
  const xff = headers["x-forwarded-for"];
  const xRealIp = headers["x-real-ip"];
  const viaProxy = !!(xff || xRealIp);
  // Trust forwarding headers only when the TCP peer is a local reverse proxy.
  // Direct/public sockets remain keyed by the unspoofable peer address.
  const isLoopbackProxy = LOOPBACK.has(socketIp);
  const proxyIp = xRealIp || (xff ? String(xff).split(",")[0].trim() : "");
  const ip = isLoopbackProxy && proxyIp ? proxyIp : socketIp;

  // Strip any client-supplied / stale copies first.
  delete headers["x-9r-real-ip"];
  delete headers["x-forwarded-for"];
  delete headers["x-9r-via-proxy"];

  headers["x-9r-real-ip"] = ip;
  if (viaProxy) headers["x-9r-via-proxy"] = "1";
}
