#!/usr/bin/env node
// Preflight: refuse to start a build on a Node runtime this app cannot load.
//
// WHY THIS EXISTS (DF-9ROUTER-67)
// ------------------------------
// The app imports `undici` (v8) statically from open-sse + the proxy-test
// routes. undici 8 builds its decompression coding table at MODULE LOAD:
//
//   zstd: createZstdDecompress.bind(null, { params: { [constants.ZSTD_d_windowLogMax]: 23 } })
//
// `zlib.createZstdDecompress` only exists on Node >= 22.15.0, and undici 8
// declares `engines.node >= 22.19.0`. On an older runtime (e.g. the Node
// v22.14.0 the README used to pin) that line throws
//
//   TypeError: Cannot read properties of undefined (reading 'bind')
//
// from inside page-data collection, so `next build` aborts after a full
// install with an error that names no prerequisite:
//
//   Error: Failed to collect configuration for /api/oauth/[provider]/[action]
//     [cause]: TypeError: Cannot read properties of undefined (reading 'bind')
//
// This check turns that into a named, actionable failure in milliseconds.
// It reads the floor from package.json `engines.node` so the requirement has
// exactly one home.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// Namespace import, NOT `import { createZstdDecompress }`: on an older runtime
// that named export does not exist, so a named import would fail to LINK the
// module (SyntaxError, "does not provide an export named …") before this
// preflight could print its diagnostic — the exact failure it exists to explain.
import * as zlib from "node:zlib";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_PATH = join(HERE, "..", "package.json");

// Minimal semver for the single comparator shape we allow (`>=X.Y.Z`).
// A richer range would need a dependency; the floor is ours to define, so
// keeping the contract narrow keeps this script dependency-free.
const FLOOR_RE = /^>=\s*(\d+)\.(\d+)\.(\d+)$/;

function parseVersion(value) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(value || "").trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compare(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

function format(parts) {
  return parts ? parts.join(".") : "unknown";
}

// `--node-version=X.Y.Z` lets the regression test drive both arms on one
// host without installing a second Node.
const argVersion = process.argv
  .slice(2)
  .map((a) => /^--node-version=(.+)$/.exec(a))
  .find(Boolean)?.[1];

const actualRaw = argVersion || process.versions.node;
const actual = parseVersion(actualRaw);

let enginesRange = "";
try {
  const pkg = JSON.parse(readFileSync(PKG_PATH, "utf8"));
  enginesRange = String(pkg?.engines?.node || "");
} catch (err) {
  console.error(`[node-version] cannot read ${PKG_PATH}: ${err.message}`);
  process.exit(1);
}

const floorMatch = FLOOR_RE.exec(enginesRange.trim());
if (!floorMatch) {
  console.error(
    `[node-version] package.json engines.node must be a single ">=X.Y.Z" floor; got ${JSON.stringify(enginesRange)}`,
  );
  process.exit(1);
}
const floor = [Number(floorMatch[1]), Number(floorMatch[2]), Number(floorMatch[3])];

if (!actual) {
  console.error(
    `[node-version] cannot parse the Node version (${JSON.stringify(actualRaw)}) — this build requires Node >= ${format(floor)}.`,
  );
  process.exit(1);
}

const tooOld = compare(actual, floor) < 0;
// The concrete API undici 8 dereferences at module load. Checking it too
// covers a runtime that reports a new version but lacks zlib zstd.
const hasZstd = typeof zlib.createZstdDecompress === "function";

if (tooOld || !hasZstd) {
  const lines = [
    "",
    "  ✖ Unsupported Node.js runtime — this build cannot start.",
    "",
    `    required : Node >= ${format(floor)}   (package.json "engines.node")`,
    `    detected : v${format(actual)}${argVersion ? " (simulated)" : ""}`,
  ];
  if (!hasZstd) {
    lines.push("    missing  : zlib.createZstdDecompress (Node >= 22.15.0)");
  }
  lines.push(
    "",
    "    Why: the app imports undici 8, whose decompression table is built at",
    "    module load with `zlib.createZstdDecompress.bind(...)`. On an older Node",
    "    that is `undefined.bind`, so `next build` dies during page-data",
    "    collection with `TypeError: Cannot read properties of undefined",
    "    (reading 'bind')` for every /api route that pulls in undici.",
    "",
    "    Fix: upgrade Node to a supported 22.x (README \"Quick Start\" has the",
    "    no-root tarball recipe), then re-run `npm ci && npm run build`.",
    "",
  );
  console.error(lines.join("\n"));
  process.exit(1);
}

console.log(`[node-version] ok — Node v${format(actual)} (required >= ${format(floor)})`);
