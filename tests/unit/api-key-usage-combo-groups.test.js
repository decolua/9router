import { describe, it, expect } from "vitest";
import { withComboSubGroups } from "@/shared/utils/comboSubGroups.js";

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

const row = (combo, rawModel, requests) => ({ combo, rawModel, requests });

describe("withComboSubGroups", () => {
  const groups = [
    { groupKey: "k1", summary: { requests: 10 }, items: [row("coding", "a", 2), row(null, "s", 3), row("coding", "b", 5)] },
    { groupKey: "k2", summary: { requests: 1 }, items: [row("chat", "o", 1)] },
  ];

  it("buckets each key's items by combo, direct calls in the fallback bucket", () => {
    const out = withComboSubGroups(groups, groupFn);
    const k1 = out.find((g) => g.groupKey === "k1");
    expect(k1.subGroups.map((s) => s.groupKey)).toEqual(["coding", "Unknown"]);
    expect(k1.subGroups[0].items).toHaveLength(2);
    expect(k1.subGroups[0].summary.requests).toBe(7);
    expect(out.find((g) => g.groupKey === "k2").subGroups).toHaveLength(1);
  });

  it("keeps the group summary/items and does not mutate its input", () => {
    const before = JSON.stringify(groups);
    const out = withComboSubGroups(groups, groupFn);
    expect(JSON.stringify(groups)).toBe(before);
    expect(out[0].summary.requests).toBe(10);
    expect(out[0].items).toHaveLength(3);
  });

  it("tolerates non-array input", () => {
    expect(withComboSubGroups(undefined, groupFn)).toEqual([]);
  });
});
