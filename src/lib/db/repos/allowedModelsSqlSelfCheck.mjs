// Allowed-model SQL builder self-check.
// Run: node src/lib/db/repos/allowedModelsSqlSelfCheck.mjs
// No framework, no deps. Uses assert. Mirrors claudeToolTypeSelfCheck.mjs style.
//
// The point of this check is agreement: buildAllowedModelsSql and
// matchesAllowedModels implement the same pattern language, so a pattern that
// admits a model in JS must admit it in the SQL WHERE clause too. Divergence
// would show a row in the listing that the request gate refuses, or the reverse.
import { buildAllowedModelsSql, parseAllowedModels, matchesAllowedModels } from "./allowedModels.js";

const results = [];
function run(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, err: err.message });
  }
}
const assert = {
  equal(a, b, msg) { if (a !== b) throw new Error(`${msg || ""} expected ${b}, got ${a}`); },
};

// LIKE emulation good enough for the ASCII ids stored in `model`: % is the
// wildcard, everything else is literal, matching is case-insensitive.
function sqlMatches(params, model) {
  return params.some((p) => {
    const rx = new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`, "i");
    return rx.test(model);
  });
}

run("null patterns means no restriction", () => {
  assert.equal(buildAllowedModelsSql(null), null, "null passes through");
  assert.equal(buildAllowedModelsSql(parseAllowedModels("*")), null, "star passes through");
  assert.equal(buildAllowedModelsSql(parseAllowedModels("")), null, "empty string is unrestricted");
});

run("single exact pattern becomes equality", () => {
  const out = buildAllowedModelsSql(parseAllowedModels("claude-opus-5"));
  assert.equal(out.sql, "(model = ?)", "exact sql");
  assert.equal(out.params[0], "claude-opus-5", "exact param");
});

run("prefix pattern becomes LIKE", () => {
  const out = buildAllowedModelsSql(parseAllowedModels("claude-*"));
  assert.equal(out.sql, "(model LIKE ?)", "prefix sql");
  assert.equal(out.params[0], "claude-%", "prefix param");
});

run("suffix pattern becomes LIKE", () => {
  const out = buildAllowedModelsSql(parseAllowedModels("*-flash"));
  assert.equal(out.sql, "(model LIKE ?)", "suffix sql");
  assert.equal(out.params[0], "%-flash", "suffix param");
});

run("multiple patterns are OR-ed with one placeholder each", () => {
  const out = buildAllowedModelsSql(parseAllowedModels("a, b*, *c"));
  assert.equal(out.sql, "(model = ? OR model LIKE ? OR model LIKE ?)", "or sql");
  assert.equal(out.params.length, 3, "three params");
  assert.equal((out.sql.match(/\?/g) || []).length, out.params.length, "placeholder count matches params");
});

run("patterns are lowercased so matching is case-insensitive", () => {
  const out = buildAllowedModelsSql(parseAllowedModels("Claude-Opus-5"));
  assert.equal(out.params[0], "claude-opus-5", "lowercased");
});

run("an empty pattern list denies everything", () => {
  assert.equal(buildAllowedModelsSql([]).sql, "1 = 0", "deny-all");
});

run("sql and the JS matcher agree on exact patterns", () => {
  const patterns = parseAllowedModels("claude-opus-5");
  const { params } = buildAllowedModelsSql(patterns);
  for (const model of ["claude-opus-5", "Claude-Opus-5", "claude-opus-4", "gpt-6", ""]) {
    assert.equal(sqlMatches(params, model), matchesAllowedModels(patterns, model), `model "${model}"`);
  }
});

run("sql and the JS matcher agree on prefix patterns", () => {
  const patterns = parseAllowedModels("claude-*");
  const { params } = buildAllowedModelsSql(patterns);
  for (const model of ["claude-opus-5", "Claude-Sonnet-5", "claude", "gemini-3-pro", ""]) {
    assert.equal(sqlMatches(params, model), matchesAllowedModels(patterns, model), `model "${model}"`);
  }
});

run("sql and the JS matcher agree on suffix patterns", () => {
  const patterns = parseAllowedModels("*-flash");
  const { params } = buildAllowedModelsSql(patterns);
  for (const model of ["qwen3.8-flash", "gemini-2.5-flash", "flash", "qwen3.8-pro"]) {
    assert.equal(sqlMatches(params, model), matchesAllowedModels(patterns, model), `model "${model}"`);
  }
});

run("a mixed pattern list agrees with the matcher on every shape", () => {
  const patterns = parseAllowedModels("claude-opus-5, gpt-*, *-flash");
  const { params } = buildAllowedModelsSql(patterns);
  for (const model of [
    "claude-opus-5", "gpt-6", "gpt-5.1", "qwen3.8-flash", "claude-opus-4",
    "gemini-3-pro", "gpt", "flash", "",
  ]) {
    assert.equal(sqlMatches(params, model), matchesAllowedModels(patterns, model), `model "${model}"`);
  }
});

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? "  ok  " : "  FAIL"} ${r.name}${r.err ? ` — ${r.err}` : ""}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
