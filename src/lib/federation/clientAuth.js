// FED-011 — central-side client-auth relay (spec §3.2).
//
// A LINKED edge forwards /v1 and mutating dashboard API requests to central
// with:
//   Authorization: Bearer <FEDERATION_TOKEN>
//   X-9r-Client-Authorization: <the end client's original Authorization>
// (see proxy.js buildUpstreamHeaders). Central's auth layers must
// authenticate the END CLIENT, not the edge — so when the presented
// Authorization IS the federation token, the real client key must be read
// from X-9r-Client-Authorization instead. Before FED-011 every proxied /v1
// call failed with "Invalid API key" because the federation token was
// validated as if it were the client's key.
//
// Trust model: the relay header is honored only when the request carries the
// federation token — possession of that token already grants full federation
// API access (roleGuard), so this does not widen the trust boundary.
//
// Standalone/central requests with a normal client key return null — callers
// fall through to their usual Authorization/x-api-key handling (zero drift
// when federation is not configured).
import { createHash, timingSafeEqual } from "node:crypto";
import { getToken } from "./config.js";

function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name) || null;
  return headers[name.toLowerCase()] || null;
}

// Constant-time compare (SHA-256 pre-hash so timingSafeEqual sees equal-length
// inputs regardless of the real token length) — same pattern as roleGuard.js.
function constantTimeEquals(a, b) {
  if (a === null || b === null) return false;
  const ha = createHash("sha256").update(String(a)).digest();
  const hb = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

// Returns the end client's API key when the request was proxied by a LINKED
// edge (Authorization === "Bearer <FEDERATION_TOKEN>" and
// X-9r-Client-Authorization is present), else null. Framework-free: works
// with Next Request (Headers.get), node:http IncomingMessage headers, and
// plain objects.
export function getRelayedClientApiKey(request) {
  const headers = request?.headers;
  if (!headers) return null;
  const auth = headerValue(headers, "authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const presented = auth.slice(7);
  const expected = getToken();
  if (!expected || !constantTimeEquals(presented, expected)) return null;
  const relayed = headerValue(headers, "x-9r-client-authorization");
  if (!relayed) return null;
  return relayed.startsWith("Bearer ") ? relayed.slice(7) : relayed;
}
