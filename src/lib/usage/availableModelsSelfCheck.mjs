// Available-model filter self-check.
// Run: node src/lib/usage/availableModelsSelfCheck.mjs
// No framework, no deps. Same style as allowedModelsSqlSelfCheck.mjs.
//
// The point of this check is agreement: the usage page's "Available Models"
// card must show exactly what the key may call. A restricted key sees only
// its own models, a "*" key sees everything, and the permission gate keeps
// the read-only endpoint on viewUsage without opening any write access.
import { filterModelsByAllowedModels, modelMatchCandidates, worstModelStatus, normalizeModelStatus } from "./availableModels.js";
import { requiredPermissionsForApiPath } from "../auth/permissionPaths.js";

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
  equal(a, b, msg) { if (a !== b) throw new Error(`${msg || ""} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); },
  deep(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg || ""} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); },
  ok(v, msg) { if (!v) throw new Error(msg || "expected truthy"); },
};

const CATALOG = [
  { name: "Opus", model: "claude-opus-5", provider: "anthropic", fullModel: "anthropic/claude-opus-5", routedModel: "anthropic/claude-opus-5", alias: "claude-opus-5", origin: "provider" },
  { name: "Sonnet", model: "claude-sonnet-5", provider: "anthropic", fullModel: "anthropic/claude-sonnet-5", routedModel: "anthropic/claude-sonnet-5", alias: "claude-sonnet-5", origin: "provider" },
  { name: "GPT", model: "gpt-6", provider: "openai", fullModel: "openai/gpt-6", routedModel: "openai/gpt-6", alias: "gpt-6", origin: "provider" },
  { name: "Flash", model: "qwen3.8-flash", provider: "qwen", fullModel: "qwen/qwen3.8-flash", routedModel: "qwen/qwen3.8-flash", alias: "qwen3.8-flash", origin: "provider" },
  { name: "My combo", model: "my-combo", provider: "combo", fullModel: "my-combo", routedModel: "my-combo", alias: "my-combo", origin: "combo" },
];

const names = (list) => list.map((e) => e.model).sort();

run("a restricted key sees only its own models", () => {
  const out = filterModelsByAllowedModels(CATALOG, "claude-opus-5, my-combo");
  assert.deep(names(out), ["claude-opus-5", "my-combo"], "restricted list");
});

run("a restricted key sees nothing it was not given", () => {
  const out = filterModelsByAllowedModels(CATALOG, "claude-opus-5");
  assert.ok(!names(out).includes("gpt-6"), "gpt-6 hidden");
  assert.ok(!names(out).includes("my-combo"), "combo hidden");
  assert.ok(!names(out).includes("claude-sonnet-5"), "sibling model hidden");
});

run("a wildcard key sees everything", () => {
  for (const raw of ["*", "", null, undefined, "  "]) {
    const out = filterModelsByAllowedModels(CATALOG, raw);
    assert.equal(out.length, CATALOG.length, `wildcard ${JSON.stringify(raw)}`);
  }
});

run("prefix and suffix patterns work like the request gate", () => {
  assert.deep(names(filterModelsByAllowedModels(CATALOG, "claude-*")), ["claude-opus-5", "claude-sonnet-5"], "prefix");
  assert.deep(names(filterModelsByAllowedModels(CATALOG, "*-flash")), ["qwen3.8-flash"], "suffix");
});

run("a provider scope admits that provider and nothing else", () => {
  const out = filterModelsByAllowedModels(CATALOG, "openai/*");
  assert.deep(names(out), ["gpt-6"], "provider scope");
});

run("matching is case-insensitive", () => {
  const out = filterModelsByAllowedModels(CATALOG, "Claude-Opus-5");
  assert.deep(names(out), ["claude-opus-5"], "case-insensitive");
});

run("a combo name admits the combo entry", () => {
  const out = filterModelsByAllowedModels(CATALOG, "my-combo");
  assert.deep(names(out), ["my-combo"], "combo by name");
});

run("an empty catalog stays empty under any allowlist", () => {
  assert.equal(filterModelsByAllowedModels([], "claude-opus-5").length, 0, "restricted");
  assert.equal(filterModelsByAllowedModels([], "*").length, 0, "wildcard");
});

run("candidates cover every spelling the gate may see", () => {
  const cands = modelMatchCandidates(CATALOG[0]);
  assert.ok(cands.includes("anthropic/claude-opus-5"), "routed id");
  assert.ok(cands.includes("claude-opus-5"), "bare id");
  assert.ok(cands.includes("anthropic/*"), "provider scope");
});

run("status rollup reports the worst member", () => {
  assert.equal(worstModelStatus(["ready", "ready"]), "ready", "all ready");
  assert.equal(worstModelStatus(["ready", "limited"]), "limited", "limited");
  assert.equal(worstModelStatus(["ready", "cooldown", "limited"]), "cooldown", "cooldown");
  assert.equal(worstModelStatus(["ready", "unavailable", "cooldown"]), "unavailable", "unavailable");
  assert.equal(worstModelStatus([]), "ready", "empty");
});

run("unknown statuses read as ready, never as broken", () => {
  assert.equal(normalizeModelStatus("bogus"), "ready", "unknown");
  assert.equal(normalizeModelStatus(null), "ready", "null");
});

run("the new endpoint stays on viewUsage for reads", () => {
  const need = requiredPermissionsForApiPath("/api/usage/available-models", "GET");
  assert.ok(Array.isArray(need) && need.includes("viewUsage"), `GET needs viewUsage, got ${JSON.stringify(need)}`);
});

run("the new endpoint grants no write access to a key", () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const need = requiredPermissionsForApiPath("/api/usage/available-models", method);
    assert.ok(!need || !need.includes("manageModels"), `${method} must not grant manageModels`);
    assert.ok(!need || !need.includes("manageProviders"), `${method} must not grant manageProviders`);
    assert.ok(!need || !need.includes("manageApiKeys"), `${method} must not grant manageApiKeys`);
  }
});

run("the usage prefix still guards the new endpoint the same way", () => {
  assert.deep(
    requiredPermissionsForApiPath("/api/usage/available-models", "GET"),
    requiredPermissionsForApiPath("/api/usage/stats", "GET"),
    "same gate as the other usage reads"
  );
});

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? "  ok  " : "  FAIL"} ${r.name}${r.err ? ` — ${r.err}` : ""}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
