#!/usr/bin/env node
// QA-9ROUTER-34: self-resolving production launcher for `npm start`.
//
// The old script was a bare `node custom-server.js`, which dies with
// MODULE_NOT_FOUND in exactly the trees QA probes use: a fresh clone (before
// `npm run build`) or a standalone bundle laid out without the repo root. The
// wrapper only exists at the repo root, while the postbuild step copies it —
// plus the src/ and node_modules/ siblings its __dirname-relative requires
// need — into `.next/standalone`.
//
// Resolution order (first hit wins). Each entry is spawned with cwd set to its
// own directory, i.e. the layout its requires were built for:
//   1. ./custom-server.js                 repo tree (documented production path)
//   2. .next/standalone/custom-server.js  postbuild-copied wrapper (Docker layout)
//   3. .next/standalone/server.js         plain Next standalone server
//   4. none of the above                  exit 1 naming `npm run build`

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const standaloneDir = join(repoRoot, ".next", "standalone");

const CANDIDATES = [
  { entry: join(repoRoot, "custom-server.js"), cwd: repoRoot, label: "repo wrapper" },
  { entry: join(standaloneDir, "custom-server.js"), cwd: standaloneDir, label: "standalone wrapper" },
  { entry: join(standaloneDir, "server.js"), cwd: standaloneDir, label: "standalone server" },
];

const chosen = CANDIDATES.find((candidate) => existsSync(candidate.entry));

if (!chosen) {
  console.error(
    [
      "9router: no server entry point found — nothing to start.",
      "",
      "Looked for:",
      ...CANDIDATES.map((candidate) => `  - ${candidate.entry}`),
      "",
      "Run `npm run build` first (it emits .next/standalone and copies",
      "custom-server.js into it), or start from the repo root, where",
      "custom-server.js is tracked.",
    ].join("\n"),
  );
  process.exit(1);
}

console.log(`9router: starting ${chosen.label} (${chosen.entry})`);

const child = spawn(process.execPath, [chosen.entry], {
  cwd: chosen.cwd,
  stdio: "inherit",
  env: process.env,
});

// Forward termination signals so Ctrl-C / kill reach the server (and its own
// shutdown logging) instead of orphaning it.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    if (!child.killed) {
      try {
        child.kill(signal);
      } catch {
        // Child already gone — nothing to forward.
      }
    }
  });
}

child.on("error", (error) => {
  console.error(`9router: failed to start ${chosen.entry}: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) process.exit(128);
  process.exit(code === null ? 1 : code);
});
