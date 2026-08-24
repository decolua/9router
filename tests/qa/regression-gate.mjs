#!/usr/bin/env node
// Regression gate: run the vitest suite and diff the failure set against a
// committed baseline snapshot. Any test that passed in the baseline but fails
// now is a regression → non-zero exit. Newly added failing tests are listed
// but do not fail the gate unless --strict.
//
// The upstream tests/__baseline__/verify-no-regression.mjs splits paths on
// "/app/" (their CI layout) and cannot match here; this gate uses basenames.
//
// Usage:
//   npm run qa:regression            # run suite + compare against baseline
//   npm run qa:baseline              # (re)generate the baseline from current tree
//   node tests/qa/regression-gate.mjs --strict

import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TESTS_DIR = join(__dirname, "..");
const BASELINE = join(__dirname, "regression-baseline.json");

const argv = process.argv.slice(2);
const GENERATE = argv.includes("--generate");
const STRICT = argv.includes("--strict");

function runSuite(outputFile) {
  console.log("Running full vitest suite (this takes a few minutes)...");
  const res = spawnSync("npx", ["vitest", "run", "--reporter=json", `--outputFile=${outputFile}`], {
    cwd: TESTS_DIR,
    stdio: ["ignore", "ignore", "inherit"],
    shell: process.platform === "win32",
    maxBuffer: undefined,
  });
  if (!existsSync(outputFile)) {
    console.error("vitest did not produce a JSON report — aborting");
    process.exit(2);
  }
  return res.status;
}

function failSet(resultsPath) {
  const r = JSON.parse(readFileSync(resultsPath, "utf8"));
  const out = new Set();
  for (const f of r.testResults || []) {
    const file = basename(f.name || "?");
    for (const a of f.assertionResults || []) {
      if (a.status === "failed") out.add(`${file} :: ${a.fullName}`);
    }
  }
  return out;
}

const resultsFile = process.env.TMPDIR || "/tmp";
const resultsPath = join(resultsFile, `vitest-qa-${Date.now()}.json`);

if (GENERATE) {
  runSuite(resultsPath);
  const current = [...failSet(resultsPath)];
  writeFileSync(BASELINE, JSON.stringify({ generatedAt: new Date().toISOString(), knownFails: current.sort() }, null, 2));
  console.log(`Baseline written: ${BASELINE} (${current.length} known failures)`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error(`No baseline at ${BASELINE}. Run \`npm run qa:baseline\` first.`);
  process.exit(2);
}

runSuite(resultsPath);
const base = new Set(JSON.parse(readFileSync(BASELINE, "utf8")).knownFails || []);
const now = failSet(resultsPath);

const regressions = [...now].filter((f) => !base.has(f)).sort();
const fixed = [...base].filter((f) => !now.has(f)).sort();

console.log(`\nfailures now: ${now.size} | baseline: ${base.size}`);
if (fixed.length) {
  console.log(`fixed since baseline (${fixed.length}):`);
  for (const f of fixed) console.log("  +", f);
}
if (regressions.length) {
  console.error(`REGRESSIONS — pass→fail since baseline (${regressions.length}):`);
  for (const f of regressions) console.error("  -", f);
  process.exit(1);
}
console.log("No regressions.");
process.exit(0);
