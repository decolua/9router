#!/usr/bin/env node
// Standalone vinext production entry.
//
// Mirrors the generated dist/standalone/server.js but installs the trustworthy
// client-IP middleware first (the vinext equivalent of the old custom-server.js
// monkey-patch over Next's standalone server). loginLimiter + dashboardGuard
// read x-9r-real-ip / x-9r-via-proxy, which vinext's own server wouldn't set.
//
// Implementation note: vinext's prod server imports `createServer` from
// node:http as an ESM named binding, which is immutable — so patching
// http.createServer (the old CJS trick) is a no-op here. Instead we let
// startProdServer create + own the server, then prepend a "request" listener
// on the returned http.Server. prependListener ensures our sanitizer runs
// before vinext's already-registered request handler, and Node passes the same
// (req, res) objects, so mutating req.headers here propagates into the Web
// Request that vinext builds and hands to route handlers.
//
// Usage:
//   node server.vinext.js                  # after `vinext build`
//   PORT=8080 HOST=127.0.0.1 node server.vinext.js
//
// The build emits dist/standalone/{dist,node_modules,public,server.js}; this
// entry reuses that output dir, so run it from the repo root.

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { injectTrustedClientIp } from "./src/lib/clientIp.js";

const { startProdServer } = await import("vinext/server/prod-server");

const here = fileURLToPath(new URL(".", import.meta.url));
const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const host = process.env.HOST ?? "0.0.0.0";

const { server } = await startProdServer({
  port,
  host,
  outDir: join(here, "dist", "standalone", "dist"),
}).catch((error) => {
  console.error("[vinext] Failed to start standalone server");
  console.error(error);
  process.exit(1);
});

// startProdServer returns the live http.Server with vinext's request handler
// already registered. Prepend our sanitizer so it runs first on every request.
server.prependListener("request", (req) => {
  try { injectTrustedClientIp(req); } catch { /* never block a request */ }
});
