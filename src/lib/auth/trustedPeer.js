// x-9r-real-ip is only trustworthy when custom-server.js stamped it from the TCP socket.
// It proves that by echoing the per-process secret it generated at boot, which a client
// cannot guess. Without the proof the header is just attacker-supplied input.
export function hasTrustedPeerHeaders(request) {
  const token = process.env.NINEROUTER_PEER_TOKEN;
  return Boolean(token) && request.headers.get("x-9r-peer-token") === token;
}

// Addresses that mean "this reached us over a network the operator owns":
// loopback, the Docker bridge, RFC1918 LANs, link-local, CGNAT and Tailscale.
// A public client address never matches, so the fresh-install default password
// stays unusable from the open internet.
export function isPrivateAddress(value) {
  let name = String(value || "").trim().toLowerCase();
  if (!name) return false;
  if (name === "localhost" || name === "unix") return true;
  if (name.startsWith("[")) {
    const end = name.indexOf("]");
    if (end !== -1) name = name.slice(1, end);
  }
  if (name.startsWith("::ffff:")) name = name.slice(7);

  const dotted = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d{1,5})?$/.test(name);
  if (name.includes(":") && !dotted) {
    return name === "::1" || name.startsWith("fe80:") || name.startsWith("fc") || name.startsWith("fd");
  }

  const host = name.split(":")[0];
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  if (a === 127 || a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

/**
 * Same trust shape as dashboardGuard.isLocalRequest, but a private peer (the
 * Docker bridge, a LAN, a tailnet) counts as the operator's own machine too.
 * Used for the first-login default password gate only, never for route access.
 */
export function isTrustedNetworkRequest(request) {
  if (hasTrustedPeerHeaders(request)) {
    if (!isPrivateAddress(request.headers.get("x-9r-real-ip"))) return false;
  } else if (process.env.NODE_ENV !== "development" || !isPrivateAddress(hostOf(request.headers.get("host")))) {
    return false;
  }
  // Cross-origin POSTs are never the operator typing their own password.
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== (request.headers.get("host") || "").trim()) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function hostOf(value) {
  const name = String(value || "").trim();
  const first = name.split(",")[0].trim();
  if (first.startsWith("[")) return first;
  return first.includes(":") ? first.slice(0, first.lastIndexOf(":")) : first;
}
