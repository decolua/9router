// Gate: so kết quả test hiện tại với baseline known-fails.
// PASS nếu KHÔNG có test nào pass(baseline) → fail(now). Test mới được phép.
// Usage: node tests/__baseline__/verify-no-regression.mjs [<current-results.json>]
//   No argument: run `npx vitest run --reporter=json` inside tests/ ourselves,
//   evaluate the produced JSON, delete the tmpfile, and propagate the verdict
//   as the exit code (0 clean, 1 regression, 2 usage/parse error).
//   Argument: a vitest JSON results file — OR a raw captured vitest stdout log;
//   non-JSON input is handled by tolerant extraction (never a raw parse crash).
import { readFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const knownFails = new Set(
  readFileSync(new URL("./known-fails.txt", import.meta.url), "utf8")
    .split("\n").map(s => s.trim()).filter(s => s && !s.startsWith("#"))
);

// Tolerant extraction for raw vitest stdout captures: the JSON reporter emits
// one big object, but a captured log can carry npm notices / node warnings
// before/after it. Scan from the first '{' to successive closing braces and
// take the largest prefix that JSON.parse accepts.
function extractResultsJson(raw, sourceName) {
  try {
    return JSON.parse(raw);
  } catch { /* fall through to tolerant extraction */ }
  const start = raw.indexOf("{");
  if (start < 0) {
    console.error(`ERROR: ${sourceName}: no JSON object found in file (not a vitest results file)`);
    process.exit(2);
  }
  // Try candidate substrings largest-first: first '{' through each '}' that
  // ends a line (vitest pretty-prints nothing by default, so the whole object
  // is one line — but accept any '}' as a fallback candidate).
  const candidates = [];
  for (let i = raw.length - 1; i > start; i--) {
    if (raw[i] === "}") candidates.push(i);
  }
  for (const end of candidates) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch { /* try the next smaller candidate */ }
  }
  console.error(`ERROR: ${sourceName}: could not extract vitest JSON results from file`);
  process.exit(2);
}

let resultsPath = process.argv[2];
let tmpResultsPath = null;

if (!resultsPath) {
  // Self-run mode: produce the results JSON ourselves so a local/dev-box run
  // can reach the regression verdict without the gitreins guard harness.
  const testsDir = dirname(dirname(fileURLToPath(import.meta.url)));
  tmpResultsPath = join(tmpdir(), `9router-vitest-selfrun-${process.pid}.json`);
  const proc = spawnSync(
    "npx",
    ["vitest", "run", "--reporter=json", `--outputFile=${tmpResultsPath}`],
    { cwd: testsDir, stdio: "inherit" }
  );
  if (proc.error) {
    console.error(`ERROR: failed to spawn vitest: ${proc.error.message}`);
    process.exit(2);
  }
  resultsPath = tmpResultsPath;
}

let raw;
try {
  raw = readFileSync(resultsPath, "utf8");
} catch (e) {
  console.error(`ERROR: ${resultsPath}: cannot read file (${e.message})`);
  process.exit(2);
}

const r = extractResultsJson(raw, resultsPath);

if (tmpResultsPath) {
  try { unlinkSync(tmpResultsPath); } catch { /* best effort */ }
}

// Normalize the test file path to a stable key: keep everything from the first
// "/tests/" segment so results match regardless of absolute prefix (/app/ in
// Docker CI, /home/<user>/<repo>/ on local runs). Falls back to the raw name
// when "tests/" is absent.
function normalizeTestFile(name) {
  const i = name.indexOf("/tests/");
  return i >= 0 ? name.slice(i + 1) : name;
}

const nowFails = r.testResults.flatMap(f =>
  f.assertionResults.filter(a => a.status === "failed")
    .map(a => normalizeTestFile(f.name) + " :: " + a.fullName)
);

// Regression = fail bây giờ NHƯNG không có trong baseline known-fails
const regressions = nowFails.filter(f => !knownFails.has(f));

if (regressions.length) {
  console.error(`\n❌ REGRESSION: ${regressions.length} test pass→fail:\n`);
  regressions.forEach(f => console.error("  - " + f));
  process.exit(1);
}
console.log(`✅ No regression. (now fails=${nowFails.length}, baseline known=${knownFails.size}, all known)`);
