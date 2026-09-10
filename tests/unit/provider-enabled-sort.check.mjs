import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../../src/app/(dashboard)/dashboard/providers/page.js", import.meta.url), "utf8");
const items = [
  { id: "empty", name: "Empty", priority: 0 },
  { id: "disabled", name: "Disabled", priority: 1 },
  { id: "enabled", name: "Enabled", priority: 999 },
  { id: "mixed", name: "Mixed", priority: 10 },
];
const stats = {
  empty: { total: 0, allDisabled: false, connected: 0 },
  disabled: { total: 1, allDisabled: true, connected: 1 },
  enabled: { total: 1, allDisabled: false, connected: 0 },
  mixed: { total: 2, allDisabled: false, connected: 1 },
};
for (const name of ["sortByPriority", "sortItemsByPriority"]) {
  const expression = source.match(new RegExp(`const ${name} = ([\\s\\S]*?\\n    \\}\\));`))[1];
  const sort = new Function("getProviderStats", `return (${expression});`)((id) => stats[id]);
  const entries = name === "sortByPriority" ? items.map(item => [item.id, item]) : items;
  const sorted = sort(entries, "oauth");
  assert.deepEqual(sorted.map(item => Array.isArray(item) ? item[0] : item.id), ["mixed", "enabled", "empty", "disabled"]);
  assert.deepEqual(entries.map(item => Array.isArray(item) ? item[0] : item.id), ["empty", "disabled", "enabled", "mixed"]);
}
console.log("Provider enabled-first sorting checks passed");
