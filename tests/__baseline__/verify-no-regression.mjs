// Gate: so kết quả test hiện tại với baseline known-fails.
// PASS nếu KHÔNG có test nào pass(baseline) → fail(now). Test mới được phép.
// Usage: node tests/__baseline__/verify-no-regression.mjs <current-results.json>
import { readFileSync } from "fs";

const knownFails = new Set(
  readFileSync(new URL("./known-fails.txt", import.meta.url), "utf8")
    .split("\n").map(s => s.trim()).filter(s => s && !s.startsWith("#"))
);

const resultsPath = process.argv[2];
if (!resultsPath) { console.error("Missing results.json path"); process.exit(2); }

const r = JSON.parse(readFileSync(resultsPath, "utf8"));

// Repo-relative test path, independent of where the suite ran (/app in Docker,
// /home/runner/work/<repo>/<repo> on GitHub Actions, a Windows checkout, ...).
function testPath(name) {
  const p = name.replace(/\\/g, "/");
  const i = p.lastIndexOf("/tests/");
  return i === -1 ? p : p.slice(i + 1);
}

const nowFails = r.testResults.flatMap(f => {
  const failed = f.assertionResults.filter(a => a.status === "failed")
    .map(a => testPath(f.name) + " :: " + a.fullName);
  // A file that fails to load reports no assertions; without this an import
  // break in a previously-green file would slip through the gate.
  if (f.status === "failed" && f.assertionResults.length === 0) failed.push(testPath(f.name) + " :: <suite failed to load>");
  return failed;
});

// "<file> :: *" in known-fails tolerates every failure in that file (e.g. a golden
// test whose snapshot was never committed); prefer exact entries everywhere else.
const knownFiles = new Set([...knownFails].filter(k => k.endsWith(" :: *")).map(k => k.slice(0, -" :: *".length)));
const isKnown = f => knownFails.has(f) || knownFiles.has(f.split(" :: ")[0]);

// Regression = fail bây giờ NHƯNG không có trong baseline known-fails
const regressions = nowFails.filter(f => !isKnown(f));

if (regressions.length) {
  console.error(`\n❌ REGRESSION: ${regressions.length} test pass→fail:\n`);
  regressions.forEach(f => console.error("  - " + f));
  process.exit(1);
}
console.log(`✅ No regression. (now fails=${nowFails.length}, baseline known=${knownFails.size}, all known)`);
