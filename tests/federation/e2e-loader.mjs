// FED-006 — e2e loader: maps the app's module resolution rules to the repo so
// the REAL application route modules (and the modules they import) can be
// loaded in a plain node child process (no Next.js build needed). Loaded via
// `node --import`.
//
// The rules mirror what the app itself declares, so a module that loads here
// resolves to the same file the app would load:
//
//   - jsconfig.json `paths`:      `@/*`      → <src>/*
//                                 `open-sse` → <repo>/open-sse
//                                 `open-sse/*` → <repo>/open-sse/*
//     Bundler-style resolution also applies: an extensionless or
//     directory-shaped target falls back to `<target>.js` then
//     `<target>/index.js` (next/webpack resolve `@/models` to
//     `src/models/index.js`; plain node ESM does not).
//   - `next/server` → `node_modules/next/server.js`. The `next` package ships
//     no `exports` map, so node ESM refuses the extensionless specifier that
//     route modules use (`import { NextResponse } from "next/server"`) while
//     CommonJS/webpack resolution accepts it. Mapping it to the real file
//     keeps the REAL NextResponse in the loop (no stub).
//   - `node-machine-id` → the named-export interop shim (see
//     e2e-node-machine-id.mjs): bundle-aware resolvers (webpack/vitest)
//     synthesise named exports from that CommonJS package, plain node ESM
//     does not (`SyntaxError: Named export 'machineIdSync' not found`).
//
// `9ROUTER_E2E_SRC_OVERLAY` (optional) is an override layer consulted BEFORE
// the repo src for `@/` imports: a directory holding just the files an
// instance must load instead of their repo counterparts. The E2E uses it for
// the route-boundary red-proof — the same instance, one route file replaced.
//
// Everything else resolves normally from the child's cwd (the repo root), so
// better-sqlite3 etc. load from the repo's node_modules.
import { registerHooks } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { statSync } from "node:fs";
import path from "node:path";

const SRC = process.env["9ROUTER_E2E_SRC"];
if (!SRC) {
  throw new Error("9ROUTER_E2E_SRC must point at the repo src/ directory");
}
const REPO = path.dirname(SRC);
const OVERLAY = process.env["9ROUTER_E2E_SRC_OVERLAY"] || null;

function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

// Bundler-style candidate resolution: exact file → `<p>.js` → `<p>/index.js`.
// Only files are returned: an existsSync hit on a DIRECTORY would hand node a
// directory URL, which fails at load time with `EISDIR: illegal operation on
// a directory, read`.
function resolveCandidate(p) {
  if (isFile(p)) return p;
  if (isFile(p + ".js")) return p + ".js";
  if (isFile(path.join(p, "index.js"))) return path.join(p, "index.js");
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const rel = specifier.slice(2);
      if (OVERLAY) {
        const overridden = resolveCandidate(path.join(OVERLAY, rel));
        if (overridden) return { url: pathToFileURL(overridden).href, shortCircuit: true };
      }
      const url = new URL(rel, pathToFileURL(SRC + "/"));
      const hit = resolveCandidate(fileURLToPath(url));
      return { url: hit ? pathToFileURL(hit).href : url.href, shortCircuit: true };
    }
    if (specifier === "open-sse" || specifier.startsWith("open-sse/")) {
      const rel = specifier === "open-sse" ? "" : specifier.slice("open-sse/".length);
      const hit = resolveCandidate(path.join(REPO, "open-sse", rel));
      if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true };
    }
    if (specifier === "next/server") {
      const p = path.join(REPO, "node_modules", "next", "server.js");
      if (isFile(p)) return { url: pathToFileURL(p).href, shortCircuit: true };
    }
    if (specifier === "node-machine-id") {
      const p = path.join(path.dirname(fileURLToPath(import.meta.url)), "e2e-node-machine-id.mjs");
      if (isFile(p)) return { url: pathToFileURL(p).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
