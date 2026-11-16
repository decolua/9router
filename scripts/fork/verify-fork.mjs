#!/usr/bin/env node
/**
 * Proves the fork's features are still wired up — run it after every upstream
 * upgrade, and after resolving any merge conflict.
 *
 *   node scripts/fork/verify-fork.mjs           # structure + registry + tests
 *   node scripts/fork/verify-fork.mjs --quick   # skip the test run
 *   node scripts/fork/verify-fork.mjs --live    # also run the live CLI tests
 *
 * File presence alone is a weak check: a half-resolved merge can leave every
 * file in place with the integration ripped out. So this also asserts the
 * built provider registry and runs the fork's own tests.
 */
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";

import {
  ADDED_FILES,
  DERIVED_ASSETS,
  FORK_LIVE_TESTS,
  FORK_PROVIDERS,
  FORK_TESTS,
  PATCHED_FILES,
} from "./fork-manifest.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const QUICK = args.includes("--quick");
const LIVE = args.includes("--live");

const failures = [];
const notes = [];

function fail(section, message, hint) {
  failures.push({ section, message, hint });
}

function ok(message) {
  console.log(`  ok  ${message}`);
}

// ── 1. files the fork adds ──────────────────────────────────────────────────
console.log("\n[1/5] added files");
for (const file of ADDED_FILES) {
  if (existsSync(join(ROOT, file))) continue;
  fail("added files", `missing: ${file}`, "Restore it from the fork branch or from fork.patch.");
}
if (!failures.length) ok(`${ADDED_FILES.length} files present`);

for (const { from, to } of DERIVED_ASSETS) {
  if (existsSync(join(ROOT, to))) continue;
  notes.push(`${to} is missing — regenerate with: cp ${from} ${to}`);
}

// ── 2. integration points inside upstream files ─────────────────────────────
console.log("\n[2/5] integration points in upstream files");
for (const { path, markers, hint } of PATCHED_FILES) {
  const full = join(ROOT, path);
  if (!existsSync(full)) {
    fail("integration", `file gone: ${path}`, hint);
    continue;
  }
  const source = readFileSync(full, "utf8");
  if (source.includes("<<<<<<<") || source.includes(">>>>>>>")) {
    fail("integration", `unresolved merge conflict in ${path}`, hint);
    continue;
  }
  const missing = markers.filter((marker) => !source.includes(marker));
  if (missing.length) fail("integration", `${path} lost: ${missing.join(", ")}`, hint);
  else ok(path);
}

// ── 3. the registry actually builds with the fork providers ─────────────────
console.log("\n[3/5] provider registry");
try {
  const { PROVIDERS } = await import(pathToFileURL(join(ROOT, "open-sse/config/providers.js")).href);
  const { PROVIDER_MODELS } = await import(pathToFileURL(join(ROOT, "open-sse/providers/index.js")).href);

  for (const expected of FORK_PROVIDERS) {
    const transport = PROVIDERS[expected.id];
    if (!transport) {
      fail("registry", `PROVIDERS["${expected.id}"] is missing`,
        "registry/index.js probably lost its import or array entry for this provider.");
      continue;
    }
    if (transport.format !== expected.format) {
      fail("registry", `${expected.id}: format is "${transport.format}", expected "${expected.format}"`);
    }
    if (transport.forceStream !== expected.forceStream) {
      fail("registry", `${expected.id}: forceStream is ${transport.forceStream}, expected ${expected.forceStream}`);
    }
    const models = PROVIDER_MODELS[expected.alias];
    if (!models?.length) {
      fail("registry", `PROVIDER_MODELS["${expected.alias}"] is empty`,
        "PROVIDER_MODELS is keyed by `alias || id`; check the registry entry's alias.");
    } else {
      ok(`${expected.id} (${expected.alias}) — ${models.length} models, format ${transport.format}`);
    }
  }
} catch (e) {
  fail("registry", `could not load the provider registry: ${e.message}`,
    "A syntax error or a bad import in one of the fork's registry/config files.");
}

// ── 4. fork tests ───────────────────────────────────────────────────────────
console.log("\n[4/5] fork tests");
if (QUICK) {
  console.log("  skipped (--quick)");
} else if (!existsSync(join(ROOT, "tests", "node_modules"))) {
  notes.push("tests/node_modules is absent — run `cd tests && npm install` to enable the test step.");
  console.log("  skipped (test deps not installed)");
} else {
  const files = LIVE ? [...FORK_TESTS, ...FORK_LIVE_TESTS] : FORK_TESTS;
  const run = spawnSync("npx", ["vitest", "run", ...files], {
    cwd: join(ROOT, "tests"),
    encoding: "utf8",
    shell: process.platform === "win32",
    env: LIVE ? { ...process.env, REAL_CLI_TESTS: "1" } : process.env,
  });
  const output = `${run.stdout || ""}${run.stderr || ""}`;
  const summary = output.split("\n").find((line) => line.includes("Tests ")) || "";
  if (run.status === 0) ok(`vitest: ${summary.trim() || "passed"}`);
  else {
    fail("tests", `vitest exited ${run.status}: ${summary.trim() || "see output"}`,
      `Re-run for detail: cd tests && npx vitest run ${files.join(" ")}`);
  }
}

// ── 5. baselines know about the fork providers ──────────────────────────────
console.log("\n[5/5] regression baselines");
const baseline = join(ROOT, "tests/__baseline__/providers-baseline.json");
if (!existsSync(baseline)) {
  notes.push("providers-baseline.json is absent — regenerate with node tests/__baseline__/snapshot-providers.mjs");
} else {
  const snapshot = readFileSync(baseline, "utf8");
  const absent = FORK_PROVIDERS.filter((p) => !snapshot.includes(`"${p.id}"`)).map((p) => p.id);
  if (absent.length) {
    notes.push(`baseline does not list ${absent.join(", ")} — regenerate it after an upgrade: `
      + "node tests/__baseline__/snapshot-providers.mjs && node tests/__baseline__/verify-alias.mjs --snapshot");
  } else ok(`providers-baseline.json lists ${FORK_PROVIDERS.map((p) => p.id).join(", ")}`);
}

// ── report ──────────────────────────────────────────────────────────────────
if (notes.length) {
  console.log("\nnotes:");
  for (const note of notes) console.log(`  - ${note}`);
}

if (failures.length) {
  console.error(`\n✗ fork verification failed (${failures.length})\n`);
  for (const { section, message, hint } of failures) {
    console.error(`  [${section}] ${message}`);
    if (hint) console.error(`      → ${hint}`);
  }
  console.error("\nSee UPGRADE.md for per-file conflict guidance.\n");
  process.exit(1);
}

console.log("\n✓ fork is intact\n");
