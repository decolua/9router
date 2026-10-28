// Gate: so kết quả test hiện tại với baseline known-fails.
// PASS nếu KHÔNG có test nào pass(baseline) → fail(now). Test mới được phép.
// Usage: node tests/__baseline__/verify-no-regression.mjs <current-results.json> [--base <base-results.json>]
//
// --base: vitest JSON from the PR's base commit. Failures already present on the base
// are tolerated, so the gate tracks master's real state instead of a hand-kept list
// that drifts. known-fails.txt still applies (and is the only baseline without --base),
// so it can hold known-flaky tests.
import { readFileSync } from "fs";

const knownFails = new Set(
  readFileSync(new URL("./known-fails.txt", import.meta.url), "utf8")
    .split("\n").map(s => s.trim()).filter(s => s && !s.startsWith("#"))
);

const args = process.argv.slice(2);
const baseFlag = args.indexOf("--base");
const basePath = baseFlag >= 0 ? args[baseFlag + 1] : null;
if (baseFlag >= 0) args.splice(baseFlag, 2);
const resultsPath = args[0];
if (!resultsPath || (baseFlag >= 0 && !basePath)) { console.error("Missing results.json path"); process.exit(2); }

const normalizeTestFile = (name) => {
  if (typeof name !== "string") return null;
  // Jest-style JSON reports may use /app/... in Docker or the GitHub runner's
  // /home/runner/work/<repo>/<repo>/... path. Baseline entries are repo-relative.
  const normalized = name.replace(/\\/g, "/");
  const testsIndex = normalized.lastIndexOf("/tests/");
  if (testsIndex >= 0) return normalized.slice(testsIndex + 1);
  if (normalized.startsWith("tests/")) return normalized;
  return normalized.split("/app/")[1] || normalized;
};

// A file that fails to import (syntax error, missing export, bad mock) reports zero
// assertions, so count the file itself as a failure or it would pass silently.
const SUITE_FAILED = "<suite failed to load>";

function collectFails(path) {
  const r = JSON.parse(readFileSync(path, "utf8"));
  return r.testResults.flatMap(f => {
    const testFile = normalizeTestFile(f.name);
    const prefix = testFile ? testFile + " :: " : "";
    const failed = f.assertionResults
      .filter(a => a.status === "failed")
      .map(a => prefix + a.fullName);
    if (!failed.length && f.status === "failed") return [prefix + SUITE_FAILED];
    return failed;
  });
}

const nowFails = collectFails(resultsPath);
const baseFails = basePath ? new Set(collectFails(basePath)) : new Set();

// Regression = fail bây giờ NHƯNG không có trong baseline known-fails (hoặc base)
const regressions = nowFails.filter(f => !knownFails.has(f) && !baseFails.has(f));

if (basePath) {
  const nowSet = new Set(nowFails);
  const fixed = [...baseFails].filter(f => !nowSet.has(f));
  if (fixed.length) console.log(`ℹ️  ${fixed.length} test(s) failing on base now pass.`);
}

if (regressions.length) {
  console.error(`\n❌ REGRESSION: ${regressions.length} test pass→fail:\n`);
  regressions.forEach(f => console.error("  - " + f));
  process.exit(1);
}
const baseNote = basePath ? `, base fails=${baseFails.size}` : "";
console.log(`✅ No regression. (now fails=${nowFails.length}, baseline known=${knownFails.size}${baseNote}, all known)`);
