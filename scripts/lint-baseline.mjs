// Repo-wide eslint debt gate for 9router.
//
// WHY: `npx eslint .` exits 1 with hundreds of pre-existing problems, so lint
// was switched OFF in the GitReins commit guard (.gitreins/config.yaml
// `guards.lint: false`) and CI never ran it. That made the debt invisible and
// unmeasured — a new eslint error could land without anyone noticing. This gate
// makes the existing debt explicit and frozen: it runs eslint over the FULL
// tree and compares the result against a committed baseline, so the debt can
// only ever go DOWN without an explicit baseline refresh.
//
// LAW 1 — matched by EXACT IDENTITY, and a stale entry FAILS the gate:
//   key = "<repo-relative file>|<ruleId>|<severity>"
//   A stale/orphan baseline entry (a problem that no longer exists) means the
//   baseline no longer describes the tree and would silently hide the very
//   regressions this gate exists to catch, so it fails instead of being ignored.
// LAW 2 — FULL-TREE scope: the committed command (`npm run lint:gate`) and the
//   documented lint command (`npm run lint` → `eslint .`) both scan the entire
//   repo; a partial or file-scoped run is not a gate.
//
// Parse errors (`fatal: true`) are ALWAYS a failure, and `--update` REFUSES to
// baseline one: a file that does not parse hides every other result for that
// file, so it must be repaired, never recorded.
//
// Usage:
//   node scripts/lint-baseline.mjs            # gate (exit 0 clean / 1 fail)
//   node scripts/lint-baseline.mjs --update   # regenerate scripts/lint-baseline.json
//
// Exit codes: 0 = baseline intact, 1 = new/increased/stale problem or a parse
// error (or --update refused), 2 = missing input or eslint could not run.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Resolved from this file, so the gate works from any cwd.
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const eslintBin = path.join(repoRoot, "node_modules", "eslint", "bin", "eslint.js");
const baselinePath = path.join(repoRoot, "scripts", "lint-baseline.json");
const update = process.argv.includes("--update");

const rel = (p) => path.relative(repoRoot, p).split(path.sep).join("/");
const sevName = (s) => (s === 2 ? "error" : s === 1 ? "warning" : `severity:${s}`);

// --- 1. eslint must be present locally -------------------------------------
// The root-local binary is used directly (node + the pinned file). Never `npx`:
// it resolves an arbitrary major from the registry when the local package is
// missing (an unpinned-major fetch hazard already filed in this repo's history).
if (!existsSync(eslintBin)) {
  console.error(
    "❌ scripts/lint-baseline.mjs: eslint is not installed at " +
      rel(eslintBin) +
      "\n   run `npm install` from the repo root and retry."
  );
  process.exit(2);
}

// --- 2. run eslint over the FULL tree, JSON output --------------------------
let raw;
try {
  raw = execFileSync(process.execPath, [eslintBin, ".", "-f", "json"], {
    cwd: repoRoot,
    encoding: "utf8",
    // Full-tree JSON is multiple MB; the 1 MB execFileSync default truncates.
    maxBuffer: 512 * 1024 * 1024,
  });
} catch (err) {
  // eslint exits 1 whenever it reports problems — that is the normal path here.
  // Exit 2 is a hard CLI/config failure and is not a lint result.
  if (err.status === 2 || (err.status !== 1 && !err.stdout)) {
    console.error("❌ scripts/lint-baseline.mjs: eslint failed to run (exit " + err.status + ")");
    if (err.stderr) console.error(err.stderr);
    process.exit(2);
  }
  raw = err.stdout;
}
if (!raw || !raw.trim()) {
  console.error("❌ scripts/lint-baseline.mjs: eslint produced no JSON output");
  process.exit(2);
}

let results;
try {
  results = JSON.parse(raw);
} catch (e) {
  console.error("❌ scripts/lint-baseline.mjs: could not parse eslint JSON: " + e.message);
  process.exit(2);
}
if (!Array.isArray(results)) {
  console.error("❌ scripts/lint-baseline.mjs: unexpected eslint JSON shape");
  process.exit(2);
}

// --- 3. totals + exact-identity counts --------------------------------------
const issues = Object.create(null);
const fatals = [];
let errors = 0;
let warnings = 0;
let problems = 0;

for (const file of results) {
  const filePath = rel(file.filePath);
  for (const m of file.messages || []) {
    problems += 1;
    if (m.severity === 2) errors += 1;
    else if (m.severity === 1) warnings += 1;
    if (m.fatal === true) {
      fatals.push({
        file: filePath,
        rule: m.ruleId || "(parse error)",
        line: m.line || 0,
        message: m.message,
      });
      continue; // never baselined, never counted as an identity key
    }
    const key = `${filePath}|${m.ruleId}|${m.severity}`;
    issues[key] = (issues[key] || 0) + 1;
  }
}

const totals = {
  errors,
  warnings,
  problems,
  filesLinted: results.length,
  filesWithProblems: results.filter((f) => (f.messages || []).length > 0).length,
};

console.log(
  `lint totals: errors=${totals.errors} warnings=${totals.warnings} ` +
    `problems=${totals.problems} filesLinted=${totals.filesLinted} ` +
    `filesWithProblems=${totals.filesWithProblems}`
);

// --- 4. parse errors always fail (and --update refuses to record one) -------
if (fatals.length) {
  console.error(`\n❌ PARSE ERROR — ${fatals.length} message(s) with fatal:true:\n`);
  for (const f of fatals) console.error(`  - ${f.file}:${f.line} ${f.message}`);
  if (update) {
    console.error(
      "\n❌ refusing to write the baseline: a file that does not parse hides every" +
        "\n   other result for that file. Repair the parse error, then re-run."
    );
  }
  process.exit(1);
}

// --- 5. --update: regenerate, refusing unless the write is meaningful -------
const serialize = (issueMap, t) => {
  const sorted = {};
  for (const k of Object.keys(issueMap).sort()) sorted[k] = issueMap[k];
  return (
    JSON.stringify(
      {
        schema: "lint-baseline/v1",
        generatedBy: "npm run lint:baseline (scripts/lint-baseline.mjs --update)",
        note:
          "Frozen repo-wide eslint debt for 9router. Key = <repo-relative file>|<ruleId>|<severity>. " +
          "The gate (npm run lint:gate) fails on any NEW or INCREASED key AND on any STALE/orphan key, " +
          "so paying debt down requires regenerating this file in the same commit.",
        scope:
          "Full tree (`eslint .` from the repo root). Gitignored build output " +
          "(`**/.next-cli-build/**`) is excluded in eslint.config.mjs and never baselined.",
        totals: t,
        issues: sorted,
      },
      null,
      2
    ) + "\n"
  );
};

const nextDoc = serialize(issues, totals);

if (update) {
  const prevDoc = existsSync(baselinePath) ? readFileSync(baselinePath, "utf8") : null;
  if (prevDoc === nextDoc) {
    console.log(`✅ baseline already current — ${rel(baselinePath)} unchanged.`);
    process.exit(0);
  }
  writeFileSync(baselinePath, nextDoc);
  console.log(
    `✅ wrote ${rel(baselinePath)} (keys=${Object.keys(issues).length}, ` +
      `errors=${totals.errors}, warnings=${totals.warnings})`
  );
  process.exit(0);
}

// --- 6. gate: compare current tree against the committed baseline -----------
if (!existsSync(baselinePath)) {
  console.error(
    `❌ scripts/lint-baseline.mjs: no baseline at ${rel(baselinePath)}` +
      "\n   run `npm run lint:baseline` and commit the result."
  );
  process.exit(2);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
} catch (e) {
  console.error(`❌ scripts/lint-baseline.mjs: could not parse ${rel(baselinePath)}: ${e.message}`);
  process.exit(2);
}
const baseIssues = baseline.issues || {};

const allKeys = new Set([...Object.keys(baseIssues), ...Object.keys(issues)]);
const parseKey = (k) => {
  const i = k.lastIndexOf("|");
  const j = k.lastIndexOf("|", i - 1);
  return { file: k.slice(0, j), rule: k.slice(j + 1, i), severity: k.slice(i + 1) };
};

const increased = [];
const stale = [];
for (const k of [...allKeys].sort()) {
  const before = baseIssues[k] ?? 0;
  const after = issues[k] ?? 0;
  if (after > before) increased.push({ k, before, after });
  else if (after < before) stale.push({ k, before, after });
}

if (increased.length) {
  console.error(`\n❌ NEW/INCREASED lint problems vs the baseline (${increased.length}):\n`);
  for (const { k, before, after } of increased) {
    const { file, rule } = parseKey(k);
    console.error(`NEW/INCREASED ${file} ${rule} ${before} -> ${after}`);
  }
}
if (stale.length) {
  console.error(`\n❌ STALE/ORPHAN baseline entries no longer present in the tree (${stale.length}):\n`);
  for (const { k, before, after } of stale) {
    const { file, rule } = parseKey(k);
    console.error(`STALE/DECREASED ${file} ${rule} ${before} -> ${after}`);
  }
  console.error(
    "\n   the baseline no longer describes this tree — run `npm run lint:baseline`" +
      "\n   and commit the refreshed baseline with the paydown."
  );
}
if (increased.length || stale.length) {
  process.exit(1);
}

console.log(
  `✅ lint baseline intact. (errors=${totals.errors}, warnings=${totals.warnings}, ` +
    `files=${totals.filesLinted})`
);
