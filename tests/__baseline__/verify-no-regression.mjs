// Gate: so kết quả test hiện tại với baseline known-fails.
// PASS nếu KHÔNG có test nào pass(baseline) → fail(now). Test mới được phép.
// Usage: node tests/__baseline__/verify-no-regression.mjs <current-results.json>
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

// Results carry ABSOLUTE file paths; known-fails.txt is keyed by repo-relative
// ones. The old "/app/" split assumed the upstream container layout and yielded
// "undefined :: <test>" in any other checkout, so every failure looked new.
const REPO_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
function repoRelative(file) {
  const rel = path.relative(REPO_ROOT, file);
  if (rel && !rel.startsWith("..")) return rel.split(path.sep).join("/");
  const marker = file.replace(/\\/g, "/").indexOf("/tests/");
  return marker >= 0 ? file.replace(/\\/g, "/").slice(marker + 1) : file;
}

const knownFails = new Set(
  readFileSync(new URL("./known-fails.txt", import.meta.url), "utf8")
    .split("\n").map(s => s.trim()).filter(s => s && !s.startsWith("#"))
);

const resultsPath = process.argv[2];
if (!resultsPath) { console.error("Missing results.json path"); process.exit(2); }

const r = JSON.parse(readFileSync(resultsPath, "utf8"));
const nowFails = r.testResults.flatMap(f =>
  f.assertionResults.filter(a => a.status === "failed")
    .map(a => repoRelative(f.name) + " :: " + a.fullName)
);

// Regression = fail bây giờ NHƯNG không có trong baseline known-fails
const regressions = nowFails.filter(f => !knownFails.has(f));

if (regressions.length) {
  console.error(`\n❌ REGRESSION: ${regressions.length} test pass→fail:\n`);
  regressions.forEach(f => console.error("  - " + f));
  process.exit(1);
}
console.log(`✅ No regression. (now fails=${nowFails.length}, baseline known=${knownFails.size}, all known)`);
