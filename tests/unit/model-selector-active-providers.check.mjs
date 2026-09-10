import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../../src/shared/components/ModelSelectModal.js", import.meta.url), "utf8");
const body = source.match(/const filteredActiveProviders = useMemo\(\(\) => \{([\s\S]*?)\n  \}, \[activeProviders, kindFilter\]\);/)[1];
const filter = new Function("activeProviders", "kindFilter", "AI_PROVIDERS", body);
const connections = [
  { id: "off", provider: "cursor", isActive: false },
  { id: "on", provider: "cursor", isActive: true },
  { id: "legacy", provider: "other" },
  { id: "web", provider: "search", isActive: true },
  { id: "hidden", provider: "iflow", isActive: true },
];
const { default: iflow } = await import("../../open-sse/providers/registry/iflow.js");
const providers = { search: { serviceKinds: ["webSearch"] }, iflow };
assert.deepEqual(filter(connections, null, providers).map(p => p.id), ["on", "legacy", "web"]);
assert.deepEqual(filter(connections, "llm", providers).map(p => p.id), ["on", "legacy"]);
assert.deepEqual(filter(connections, "webSearch", providers).map(p => p.id), ["web"]);
assert.deepEqual(filter([connections[0]], null, providers), []);
assert.deepEqual(filter([connections[4]], null, providers), []);
assert.match(source, /sortedProviderIds\.forEach\(\(providerId\) => \{\s*if \(AI_PROVIDERS\[providerId\]\?\.hidden\) return;/);
console.log("Model selector active-provider checks passed");
