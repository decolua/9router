#!/usr/bin/env node
// Preflight for the root `npm test` entry — see AGENTS.md "Commands".
//
// The test suite is an INDEPENDENT ESM package under tests/ and the vitest it
// runs is declared ONLY there (tests/package.json: "vitest": "^4.0.0"), so
// tests/node_modules/.bin/vitest is the single pinned runner. The root
// package.json deliberately has no vitest dependency.
//
// Without this guard a bare `npx vitest` from the repo root resolves whatever
// vitest major the registry/ npx cache happens to hold (observed: vitest/5.0.1
// against the pinned 4.1.10) and then dies with a confusing CACError such as
// `Unknown option --runInBand`, which reads like a broken suite instead of a
// missing install. Fail fast and actionably instead — never download anything.
//
// Dependency-free on purpose: node builtins only, so it runs on a bare clone.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const vitestBin = join(repoRoot, "tests", "node_modules", ".bin", "vitest");

// existsSync follows symlinks, so a dangling shim counts as missing.
if (existsSync(vitestBin)) process.exit(0);

console.error(
  [
    "",
    "9router: tests/node_modules is missing — vitest cannot be resolved.",
    "",
    "The suite lives in the independent tests/ package, which is where vitest",
    '(tests/package.json pins "vitest": "^4.0.0") is installed. Install its deps first:',
    "",
    "    cd tests && npm install",
    "",
    "On a fresh clone run the root install too — tests/ imports from src/, which",
    "needs the root deps (open, undici, …):",
    "",
    "    npm install && cd tests && npm install",
    "",
    "Refusing to fall back to an unpinned `npx vitest`: that downloads an arbitrary",
    "vitest major from the registry and fails with a misleading CACError. Then re-run:",
    "",
    "    npm test",
    "",
  ].join("\n")
);
process.exit(1);
