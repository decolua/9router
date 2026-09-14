// FED-006 — e2e loader: maps the app's `@/` import alias to the repo src/ so
// the federation modules can be imported in a plain node child process
// (no Next.js build needed). Loaded via `node --import`.
//
// The app source uses `@/lib/...` (jsconfig alias). Node cannot resolve that
// bare specifier, so this hook rewrites it to an absolute file URL under
// 9ROUTER_E2E_SRC (the repo's src/). Extensionless `@/` imports (e.g.
// `@/lib/federation/server` in the route wrappers) get a `.js` fallback.
//
// Only the `@/` alias is mapped — everything else resolves normally from the
// child's cwd (the repo root), so better-sqlite3 etc. load from the repo's
// node_modules.
import { registerHooks } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const SRC = process.env["9ROUTER_E2E_SRC"];
if (!SRC) {
  throw new Error("9ROUTER_E2E_SRC must point at the repo src/ directory");
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = pathToFileURL(SRC + "/");
      const url = new URL(specifier.slice(2), base);
      const p = fileURLToPath(url);
      if (!existsSync(p)) {
        const withJs = p + ".js";
        if (existsSync(withJs)) {
          return { url: pathToFileURL(withJs).href, shortCircuit: true };
        }
      }
      return { url: url.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
