// Node ESM resolver/loader for the repo source used by the producer fixture.
//
// The repo root package.json is intentionally CommonJS by default because Next
// consumes these files. A plain Node child must therefore both resolve the two
// aliases and force ESM format for source files.
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../../../", import.meta.url);
const SRC = new URL("src/", ROOT);
const OPEN_SSE = new URL("open-sse/", ROOT);
const isRepoSource = (url) => url.startsWith(SRC.href) || url.startsWith(OPEN_SSE.href);

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    return { url: new URL(`src/${specifier.slice(2)}`, ROOT).href, shortCircuit: true };
  }
  if (specifier === "open-sse") {
    return { url: new URL("open-sse/index.js", ROOT).href, shortCircuit: true };
  }
  if (specifier.startsWith("open-sse/")) {
    return { url: new URL(specifier, ROOT).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (!url.startsWith("file:") || !isRepoSource(url)) return nextLoad(url, context);
  const source = await fs.readFile(fileURLToPath(url), "utf8");
  return { format: "module", source, shortCircuit: true };
}
