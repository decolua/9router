// Minimal ESM resolver hook so plain `node` can run modules that use the
// project's `@/*` and `open-sse/*` path aliases (defined in jsconfig.json,
// normally resolved by the Next.js / vitest bundler).
//
//   node --import ./scripts/alias-hook-register.mjs scripts/pg-smoke.mjs
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();

// Bundler-style imports omit the extension ("@/shared/utils/apiKey"). Resolve
// it to a real file the way webpack/vitest would.
function resolveFsPath(abs) {
  const candidates = [abs, `${abs}.js`, `${abs}.mjs`, path.join(abs, "index.js")];
  return candidates.find((c) => {
    try { return fs.statSync(c).isFile(); } catch { return false; }
  }) || abs;
}

export async function resolve(specifier, context, nextResolve) {
  let abs = null;
  if (specifier.startsWith("@/")) {
    abs = path.join(root, "src", specifier.slice(2));
  } else if (specifier === "open-sse") {
    abs = path.join(root, "open-sse", "index.js");
  } else if (specifier.startsWith("open-sse/")) {
    abs = path.join(root, specifier);
  }
  if (abs) {
    return nextResolve(pathToFileURL(resolveFsPath(abs)).href, context);
  }
  return nextResolve(specifier, context);
}
