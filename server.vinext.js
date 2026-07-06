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
// This file is location-portable: `outDir` resolves relative to its own
// location, so it works both at the repo root (dist/standalone/dist) and when
// copied into the CLI bundle (cli/app/dist).
//
// Usage:
//   node server.vinext.js                        # after `vinext build`
//   PORT=20128 HOST=0.0.0.0 node server.vinext.js
//   HOSTNAME=0.0.0.0 node server.vinext.js       # legacy Next env name also accepted

import { existsSync } from "node:fs";
import { join } from "node:path";
import { injectTrustedClientIp } from "./src/lib/clientIp.js";

const { startProdServer } = await import("vinext/server/prod-server");

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
// vinext reads HOST; Next's standalone used HOSTNAME. Accept both for parity.
const host = process.env.HOST ?? process.env.HOSTNAME ?? "0.0.0.0";

// Resolve the vinext server bundle dir relative to THIS file.
// - Repo root layout:  <root>/server.vinext.js → <root>/dist/standalone/dist
// - Bundled (cli/app): <cli/app>/server.vinext.js → <cli/app>/dist
const here = import.meta.dirname;
const outDir = existsSync(join(here, "dist", "standalone", "dist"))
  ? join(here, "dist", "standalone", "dist")
  : join(here, "dist");

const { server } = await startProdServer({
  port,
  host,
  outDir,
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
