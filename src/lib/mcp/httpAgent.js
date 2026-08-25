/**
 * Shared undici Agent for remote MCP HTTP calls.
 *
 * `sendToRemoteServer` runs on every gateway JSON-RPC message. Without a
 * shared connection pool each call pays the full TCP + TLS handshake cost
 * (typically 50–150 ms on subsequent hops to the same origin). A per-origin
 * pooled Agent with keep-alive collapses that to a single handshake per
 * origin, then reuses the socket for the lifetime of the process.
 *
 * Kept on `globalThis` so the pool survives Next.js hot reloads in dev.
 */

import { Agent } from "undici";

const G_KEY = "__9routerMcpHttpAgent";

// Enough headroom for typical gateway fan-out (many parallel requests to the
// same remote), while keeping the pool bounded so we don't leak sockets.
const CONNECTIONS_PER_ORIGIN = 32;
const KEEP_ALIVE_TIMEOUT_MS = 60_000;
const KEEP_ALIVE_MAX_TIMEOUT_MS = 10 * 60_000;
// Body/headers timeouts must be ≥ REMOTE_REQUEST_TIMEOUT_MS in transports.js
// (default 5 min) — otherwise undici will kill long-running remote MCP calls
// like firecrawl_crawl or stitch generation before our own timeout fires.
const HEADERS_TIMEOUT_MS = 60_000;
const BODY_TIMEOUT_MS = 300_000;

/** Lazy-init a process-wide dispatcher for MCP remote calls. */
export function getMcpHttpAgent() {
  if (!globalThis[G_KEY]) {
    globalThis[G_KEY] = new Agent({
      connections: CONNECTIONS_PER_ORIGIN,
      keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS,
      keepAliveMaxTimeout: KEEP_ALIVE_MAX_TIMEOUT_MS,
      headersTimeout: HEADERS_TIMEOUT_MS,
      bodyTimeout: BODY_TIMEOUT_MS,
      pipelining: 1, // pipelining=0 disables reuse; 1 = one request per socket at a time
    });
  }
  return globalThis[G_KEY];
}
