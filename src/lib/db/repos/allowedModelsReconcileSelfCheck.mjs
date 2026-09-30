// Allowed-model reconciliation self-check.
// Run: node src/lib/db/repos/allowedModelsReconcileSelfCheck.mjs
// No framework, no deps. Uses a local assert. Same style as allowedModelsSqlSelfCheck.mjs.
import { applyModelChangesToAllowList, parseAllowedModels, matchesAllowedModels } from "./allowedModels.js";

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
  ok(v, msg) { if (!v) throw new Error(msg || "expected truthy"); },
};

run("an unrestricted key is never touched", () => {
  for (const list of ["*", "", null, undefined, "  "]) {
    const out = applyModelChangesToAllowList(list, { removed: ["gpt-5.6-sol"] });
    assert.equal(out.changed, false, "no change for a wildcard key");
    assert.equal(out.emptied, false, "nothing emptied");
  }
});

run("a deleted model is dropped from the list", () => {
  const out = applyModelChangesToAllowList("gpt-5.6-sol, claude-opus-5", { removed: ["gpt-5.6-sol"] });
  assert.equal(out.value, "claude-opus-5", "dead id removed");
  assert.equal(out.changed, true, "reported as changed");
});

run("a deleted model matches regardless of case", () => {
  const out = applyModelChangesToAllowList("GPT-5.6-Sol, claude-opus-5", { removed: ["gpt-5.6-sol"] });
  assert.equal(out.value, "claude-opus-5", "case-insensitive removal");
});

run("a provider-qualified spelling is dropped too", () => {
  const out = applyModelChangesToAllowList("openai-compatible-abc/gpt-5.6-sol, claude-opus-5", { removed: ["openai-compatible-abc/gpt-5.6-sol"] });
  assert.equal(out.value, "claude-opus-5", "qualified id removed");
});

run("a rename rewrites the entry", () => {
  const out = applyModelChangesToAllowList("gpt-5.6-sol, claude-opus-5", { renamed: { "gpt-5.6-sol": "gpt-5.7-sol" } });
  assert.equal(out.value, "gpt-5.7-sol,claude-opus-5", "id followed the rename, list rejoined canonically");
});

run("a rename to nothing removes the entry rather than blanking it", () => {
  const out = applyModelChangesToAllowList("gpt-5.6-sol, claude-opus-5", { renamed: { "gpt-5.6-sol": "" } });
  assert.equal(out.value, "claude-opus-5", "entry dropped");
});

run("wildcard patterns are never pruned", () => {
  const list = "claude-*, gpt-5.6-sol, *-flash";
  const out = applyModelChangesToAllowList(list, { removed: ["claude-opus-5", "gpt-5.6-sol", "qwen3.8-flash"] });
  assert.equal(out.value, "claude-*,*-flash", "wildcards survive, exact id goes");
});

run("a wildcard is not rewritten by a rename either", () => {
  const out = applyModelChangesToAllowList("claude-*, gpt-5.6-sol", { renamed: { "claude-*": "x-*" } });
  assert.equal(out.value, "claude-*, gpt-5.6-sol", "wildcard untouched");
});

run("unknown ids are left alone", () => {
  const list = "something-nobody-told-us-about, gpt-5.6-sol";
  const out = applyModelChangesToAllowList(list, { removed: ["a-different-model"] });
  assert.equal(out.value, list, "no collateral pruning");
});

run("pruning the last id is reported instead of writing an empty list", () => {
  const out = applyModelChangesToAllowList("gpt-5.6-sol", { removed: ["gpt-5.6-sol"] });
  assert.equal(out.emptied, true, "emptied reported");
  assert.equal(out.changed, false, "nothing written");
  assert.equal(out.value, "gpt-5.6-sol", "old value kept");
});

run("an emptied list would have meant no restriction, which is why it is refused", () => {
  // Guards the reason the rule above exists: parseAllowedModels("") is null and
  // matchesAllowedModels(null, x) is true, so an empty string unlocks the key.
  assert.equal(parseAllowedModels(""), null, "empty parses to null");
  assert.equal(matchesAllowedModels(null, "anything"), true, "null allows everything");
});

run("running twice changes nothing the second time", () => {
  const changes = { removed: ["gpt-5.6-sol"], renamed: { "old-model": "new-model" } };
  const first = applyModelChangesToAllowList("gpt-5.6-sol, old-model, claude-opus-5", changes);
  const second = applyModelChangesToAllowList(first.value, changes);
  assert.equal(second.value, first.value, "idempotent");
  assert.equal(second.changed, false, "second pass is a no-op");
});

run("order is preserved and a rebuild rejoins canonically", () => {
  const out = applyModelChangesToAllowList("a-model,  b-model ,c-model", { removed: ["b-model"] });
  assert.equal(out.value, "a-model,c-model", "order kept, commas normalised");
});

run("a list nobody touched is left byte-identical", () => {
  const spaced = "a-model,  b-model ,c-model";
  const out = applyModelChangesToAllowList(spaced, { removed: ["unrelated"] });
  assert.equal(out.value, spaced, "no rewrite when nothing actually changed");
  assert.equal(out.changed, false, "reported as unchanged");
});

run("an empty change set is a no-op", () => {
  const out = applyModelChangesToAllowList("a-model, b-model", {});
  assert.equal(out.changed, false, "nothing removed");
  assert.equal(out.value, "a-model, b-model", "value kept");
  const none = applyModelChangesToAllowList("a-model", { removed: [], renamed: {} });
  assert.equal(none.changed, false, "explicitly empty change set");
});

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? "  ok  " : "  FAIL"} ${r.name}${r.err ? ` — ${r.err}` : ""}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
