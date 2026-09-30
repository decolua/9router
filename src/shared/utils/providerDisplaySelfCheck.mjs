// Provider label rules for the model picker.
// Run: node src/shared/utils/providerDisplaySelfCheck.mjs
// No framework, no deps. Each case is a shape the picker actually produced.
import { humanizeCompatId, resolveProviderName, findOwningGroupId } from "./providerDisplay.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const CHAT_NODE = "openai-compatible-chat-b5bca155-fc33-4899-a868-2ff3d7891e3c";
const RESPONSES_NODE = "openai-compatible-responses-46fbd0dc-e79f-48c8-9e4a-620231adbeaf";
const ANTHROPIC_NODE = "anthropic-compatible-chat-7c1d9a55-2f0b-4d1e-9a3c-5b6e8f0a1d22";
const UUID_FRAGMENT = "b5bca155-fc33-4899-a868-2ff3d7891e3c";
const CHAT_SHORT_ID = UUID_FRAGMENT.slice(0, 8); // "b5bca155"

// --- the reported leak ---

run("REPORT: a chat node is never titled with its own id", () => {
  const label = humanizeCompatId(CHAT_NODE);
  assert.ok(label.length > 0, "expected a non-empty label");
  assert.ok(!label.includes(UUID_FRAGMENT), `label leaked the uuid: ${label}`);
  assert.ok(!label.includes("openai-compatible-chat-"), `label leaked the raw id: ${label}`);
});

run("REPORT: a node missing from providerNodes still gets a readable heading", () => {
  // This is the picker path that printed the raw id: no node record, so the
  // registry fallback is `{ name: providerId }` and the id reached the heading.
  const registry = { name: CHAT_NODE, color: "#666" };
  const name = resolveProviderName(CHAT_NODE, { registry });
  assert.ok(name !== CHAT_NODE, "raw id became the heading");
  assert.ok(name.startsWith("OpenAI Compatible"), "family prefix present");
});

run("REPORT: an empty node list during the first render does not show ids", () => {
  // providerNodes is fetched after mount, so the first pass sees an empty array.
  const name = resolveProviderName(CHAT_NODE, { node: undefined, connection: undefined, registry: { name: CHAT_NODE } });
  assert.ok(name !== CHAT_NODE, "first-render heading leaked the id");
});

run("REPORT: a custom model bound to a known node does not open a second group", () => {
  // A compatible group is keyed by the node id and stores the prefix as its
  // display alias, so an alias-only lookup misses and a duplicate opens.
  const groups = { [CHAT_NODE]: { alias: "orf", name: "My Router", models: [] } };
  const aliasIndex = new Map([["orf", CHAT_NODE]]);
  assert.equal(findOwningGroupId(groups, aliasIndex, CHAT_NODE), CHAT_NODE, "id lookup failed");
});

run("REPORT: the duplicate group is never headed by the id", () => {
  const groups = {};
  const aliasIndex = new Map();
  const providerAlias = CHAT_NODE;
  const node = providerNodes().find((n) => n.id === providerAlias);
  const name = resolveProviderName(providerAlias, { node }) || "Custom Models";
  assert.ok(name !== providerAlias, "raw id became the heading");
  assert.ok(name.startsWith("OpenAI Compatible"), "family label used");
});

// A small stand-in for the node list the picker receives, so the bucket case
// runs the same lookup the component does.
function providerNodes() {
  return [{ id: RESPONSES_NODE, name: "Office Box" }];
}

// --- family labels ---

run("a responses node is labelled", () => {
  assert.ok(humanizeCompatId(RESPONSES_NODE).startsWith("OpenAI Compatible"), "unexpected label");
});

run("an anthropic node gets its own family label with short uuid", () => {
  const label = humanizeCompatId(ANTHROPIC_NODE);
  assert.ok(label.startsWith("Anthropic Compatible"), `expected Anthropic Compatible prefix, got ${label}`);
  assert.ok(label.includes("7c1d9a55"), `expected short uuid 7c1d9a55 in ${label}`);
  assert.ok(!label.includes("7c1d9a55-2f0b-4d1e"), "label contains too much uuid");
});

run("chat and responses of one family share a label", () => {
  const a = humanizeCompatId("openai-compatible-chat-aaaa-bbbb-cccc-dddd-eeeeffff0000");
  const b = humanizeCompatId("openai-compatible-responses-1111-2222-3333-4444-555566667777");
  assert.ok(a.startsWith("OpenAI Compatible"), "chat label ok");
  assert.ok(b.startsWith("OpenAI Compatible"), "responses label ok");
});

run("regression: no compat id ever labels itself", () => {
  for (const id of [CHAT_NODE, RESPONSES_NODE, ANTHROPIC_NODE, "openai-compatible-chat-x", "anthropic-compatible-responses-y"]) {
    assert.ok(humanizeCompatId(id) !== id, `id ${id} labelled itself`);
  }
});

// --- what is not a compat node ---

run("a non compat id resolves to empty so callers keep their own default", () => {
  assert.equal(humanizeCompatId(""), "", "empty string");
  assert.equal(humanizeCompatId("custom"), "", "bare custom");
  assert.equal(humanizeCompatId("openai"), "", "single word");
  assert.equal(humanizeCompatId("openai-compatible"), "", "prefix only");
  assert.equal(humanizeCompatId("openai-compatible-bogus-uuid"), "", "unknown api type");
  assert.equal(humanizeCompatId("deepseek"), "", "ordinary provider");
  assert.equal(humanizeCompatId("openai-chat-uuid"), "", "no compatible segment");
});

run("non string input does not throw", () => {
  assert.equal(humanizeCompatId(null), "", "null");
  assert.equal(humanizeCompatId(undefined), "", "undefined");
  assert.equal(humanizeCompatId(42), "", "number");
  assert.equal(humanizeCompatId({}), "", "object");
});

// --- precedence ---

run("a node name beats the family label", () => {
  assert.equal(resolveProviderName(CHAT_NODE, { node: { name: "My Router" } }), "My Router", "unexpected name");
});

run("a connection name beats the family label when the node is unknown", () => {
  assert.equal(resolveProviderName(CHAT_NODE, { connection: { name: "Office Box" } }), "Office Box", "unexpected name");
});

run("a node name beats a connection name", () => {
  const name = resolveProviderName(CHAT_NODE, { node: { name: "Node" }, connection: { name: "Conn" } });
  assert.equal(name, "Node", "unexpected name");
});

run("a known registry alias is used as-is", () => {
  // A plain alias is already a label, so it must not be replaced.
  const name = resolveProviderName("deepseek", { registry: { name: "DeepSeek" } });
  assert.equal(name, "DeepSeek", "unexpected name");
});

run("a registry entry whose name is the id is not trusted as a label", () => {
  const name = resolveProviderName(CHAT_NODE, { registry: { name: CHAT_NODE } });
  assert.ok(name !== CHAT_NODE, "registry echoed the id back as a name");
});

run("nothing known at all resolves to empty", () => {
  assert.equal(resolveProviderName("deepseek"), "", "unknown plain id");
  assert.equal(resolveProviderName(""), "", "empty string id");
  assert.equal(resolveProviderName(null), "", "null id");
});

run("an empty node name does not win over the family label", () => {
  const name = resolveProviderName(CHAT_NODE, { node: { name: "" }, registry: { name: CHAT_NODE } });
  assert.ok(name.startsWith("OpenAI Compatible"), "family prefix present");
});

// Two compat nodes must not collide on one heading — they are different providers.
run("N compat nodes get N distinct labels for distinct uuids", () => {
  const nodes = [
    "openai-compatible-chat-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "openai-compatible-chat-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    "openai-compatible-chat-cccccccc-cccc-cccc-cccc-cccccccccccc",
  ];
  const labels = nodes.map(humanizeCompatId);
  assert.equal(new Set(labels).size, labels.length, `expected ${labels.length} distinct labels, got ${JSON.stringify(labels)}`);
});

// The fallback never leaks a uuid but still disambiguates.
run("REPORT: a compat heading does not leak the full uuid yet is distinct between nodes", () => {
  const label = humanizeCompatId(CHAT_NODE);
  assert.ok(!label.includes(UUID_FRAGMENT), `leaked uuid in ${label}`);
  assert.ok(label.includes(CHAT_SHORT_ID), `expected short uuid ${CHAT_SHORT_ID} in ${label}`);
  const other = humanizeCompatId("openai-compatible-chat-00000000-aaaa-bbbb-cccc-111122223333");
  assert.ok(other !== label, `two ids produced same heading: ${label}`);
});

// --- owner lookup ---

run("a custom model still matches a group indexed by its alias", () => {
  const groups = { "some-provider": { alias: "mine", models: [] } };
  const aliasIndex = new Map([["mine", "some-provider"]]);
  assert.equal(findOwningGroupId(groups, aliasIndex, "MINE"), "some-provider", "alias lookup is case sensitive");
});

run("an alias hit wins over the id hit", () => {
  const groups = { [CHAT_NODE]: { alias: "orf", models: [] }, other: { alias: CHAT_NODE, models: [] } };
  const aliasIndex = new Map([[CHAT_NODE.toLowerCase(), "other"]]);
  assert.equal(findOwningGroupId(groups, aliasIndex, CHAT_NODE), "other", "alias should win");
});

run("an alias pointing at a deleted group is ignored", () => {
  assert.equal(findOwningGroupId({}, new Map([["gone", "deleted-provider"]]), "gone"), null, "stale alias must not resolve");
});

run("an unknown alias opens no group and returns null", () => {
  const groups = { [CHAT_NODE]: { alias: "orf", models: [] } };
  const aliasIndex = new Map([["orf", CHAT_NODE]]);
  assert.equal(findOwningGroupId(groups, aliasIndex, RESPONSES_NODE), null, "unknown alias should not resolve");
});

run("a missing alias index does not throw", () => {
  const groups = { [CHAT_NODE]: { alias: "orf", models: [] } };
  assert.equal(findOwningGroupId(groups, null, CHAT_NODE), CHAT_NODE, "id lookup without an index");
  assert.equal(findOwningGroupId(groups, undefined, "unknown"), null, "no index, no match");
});

run("an empty alias returns null so a bucket is still created", () => {
  assert.equal(findOwningGroupId({}, new Map(), ""), null, "empty string");
  assert.equal(findOwningGroupId({}, new Map(), null), null, "null");
  assert.equal(findOwningGroupId({}, new Map(), undefined), null, "undefined");
});

// --- structural guard on the component itself ---

// The util can be perfect while the picker keeps reaching for the registry
// fallback, which is `{ name: providerId }` and therefore the id. Reading the
// component is the only way to catch that, since the leak is a string choice
// rather than a behaviour.
run("the picker no longer falls back to the raw provider id for a group name", () => {
  const src = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../components/ModelSelectModal.js"),
    "utf8",
  );
  const leaks = [
    "node?.name || (modelAlias ? modelAlias",
    "matchedNode?.name || providerInfo.name",
    "matchedNode?.name || connection?.name || providerInfo.name",
  ];
  for (const leak of leaks) {
    assert.ok(!src.includes(leak), `picker still contains: ${leak}`);
  }
  assert.ok(src.includes("resolveProviderName"), "picker does not use resolveProviderName");
  assert.ok(src.includes("findOwningGroupId"), "picker does not use findOwningGroupId");
});

run("the picker no longer matches an owning group by alias alone", () => {
  const src = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../components/ModelSelectModal.js"),
    "utf8",
  );
  assert.ok(!src.includes("aliasToGroupId.get(modelAlias.toLowerCase())"), "alias-only lookup is back");
});

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? "  ok  " : "  FAIL"} ${r.name}${r.err ? ` — ${r.err}` : ""}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
