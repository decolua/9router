// FED-GAP-04 — plain-node ESM interop for the `node-machine-id` CommonJS
// package (main: dist/index.js, no "type", no exports map).
//
// The loader maps the bare `node-machine-id` specifier here because a bundle-
// aware resolver (webpack in the app, vite in vitest) synthesises named
// exports for that package's `exports.machineIdSync = …`, while plain node ESM
// refuses the named import the app's own modules use and throws
// `SyntaxError: Named export 'machineIdSync' not found` — which is why the
// e2e child had to hand-derive the machine id before this shim existed.
//
// This is a resolution adapter, not a stub: the REAL package file is required
// and its real exports are re-exported.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Absolute path on purpose: a bare `require("node-machine-id")` re-enters the
// loader's own mapping for that specifier (module hooks apply to require too)
// and would resolve back to this shim — `ERR_REQUIRE_CYCLE_MODULE`.
const REPO = path.resolve(HERE, "..", "..");
const require = createRequire(import.meta.url);
const mod = require(path.join(REPO, "node_modules", "node-machine-id", "dist", "index.js"));

export const machineIdSync = mod.machineIdSync;
export const machineId = mod.machineId;
export default mod;
