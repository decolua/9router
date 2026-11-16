import { describe, it, expect } from "vitest";
import { withProviderSubGroups } from "@/shared/utils/providerSubGroups.js";

// Stand-in for groupDataByKey (the real one lives in a JSX module vitest can't
// load): buckets by item[keyField] and sums requests.
function groupFn(items, keyField) {
  const map = new Map();
  for (const item of items) {
    const k = item[keyField] || "Unknown";
    if (!map.has(k)) map.set(k, { groupKey: k, summary: { requests: 0 }, items: [] });
    const g = map.get(k);
    g.summary.requests += item.requests || 0;
    g.items.push(item);
  }
  return [...map.values()];
}

const row = (provider, rawModel, requests) => ({ provider, rawModel, requests });

describe("withProviderSubGroups", () => {
  const groups = [
    { groupKey: "k1", summary: { requests: 10 }, items: [row("openai", "a", 2), row("claude", "s", 3), row("openai", "b", 5)] },
    { groupKey: "k2", summary: { requests: 1 }, items: [row("claude", "o", 1)] },
  ];

  it("buckets each group's items by provider", () => {
    const out = withProviderSubGroups(groups, groupFn);
    const k1 = out.find((g) => g.groupKey === "k1");
    expect(k1.subGroups.map((s) => s.groupKey)).toEqual(["openai", "claude"]);
    expect(k1.subGroups[0].items).toHaveLength(2);
    expect(k1.subGroups[0].summary.requests).toBe(7);
    expect(out.find((g) => g.groupKey === "k2").subGroups).toHaveLength(1);
  });

  it("keeps the group summary/items and does not mutate its input", () => {
    const before = JSON.stringify(groups);
    const out = withProviderSubGroups(groups, groupFn);
    expect(JSON.stringify(groups)).toBe(before);
    expect(out[0].summary.requests).toBe(10);
    expect(out[0].items).toHaveLength(3);
  });

  it("tolerates non-array input", () => {
    expect(withProviderSubGroups(undefined, groupFn)).toEqual([]);
  });
});
