// Gate: so kết quả test hiện tại với baseline known-fails.
// PASS nếu KHÔNG có test nào pass(baseline) → fail(now). Test mới được phép.
// Usage: node tests/__baseline__/verify-no-regression.mjs <current-results.json>
import { readFileSync } from "fs";

const knownFails = new Set(
  readFileSync(new URL("./known-fails.txt", import.meta.url), "utf8")
    .split("\n").map(s => s.trim()).filter(Boolean)
);

const resultsPath = process.argv[2];
if (!resultsPath) { console.error("Missing results.json path"); process.exit(2); }

// Anchor on the last "/tests/" segment so the gate works on any checkout root
// (Docker /app, GitHub runner /home/runner/..., Windows D:\...) — not just "/app/".
const relPath = (abs) => {
  const norm = String(abs).split("\\").join("/");
  const i = norm.lastIndexOf("/tests/");
  return i >= 0 ? norm.slice(i + 1) : norm;
};

const r = JSON.parse(readFileSync(resultsPath, "utf8"));
const nowFails = r.testResults.flatMap(f => {
  const assertionFails = f.assertionResults
    .filter(a => a.status === "failed")
    .map(a => relPath(f.name) + " :: " + a.fullName);
  // File-level failures (collection/import errors) have zero assertionResults
  // and would otherwise slip past the gate. Use a stable synthetic name.
  if (f.status === "failed" && assertionFails.length === 0) {
    assertionFails.push(relPath(f.name) + " :: [file] collection failed");
  }
  return assertionFails;
});

// Regression = fail bây giờ NHƯNG không có trong baseline known-fails
const regressions = nowFails.filter(f => !knownFails.has(f));

if (regressions.length) {
  console.error(`\n❌ REGRESSION: ${regressions.length} test pass→fail:\n`);
  regressions.forEach(f => console.error("  - " + f));
  process.exit(1);
}
console.log(`✅ No regression. (now fails=${nowFails.length}, baseline known=${knownFails.size}, all known)`);
