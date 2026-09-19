/**
 * CB3/NIT-4 (revisted na CB5) — buildComboUsageMap is the NAME HEURISTIC only.
 *
 * CB3 added a `meta.combo` priority branch here. REV-D proved it never runs in
 * production: the sole caller (UsageStats "combo" view) feeds the function
 * `stats.byModel` — rows pre-aggregated by provider/model in
 * usageRepo.getUsageStats — and those entries never carry `meta` (the SQL
 * doesn't even select the column). Live combo attribution is served by
 * GET /api/usage/combo-stats (D13), not here. CB5 REVERTED the dead branch
 * (smallest honest fix) and this file now pins the consequence:
 *  • a model row appears under EVERY combo listing it as member — legacy
 *    behavior D13 kept — even when the item object happens to carry a
 *    meta.combo (nothing is ever "trusting" it client-side);
 *  • no `attributed` flag is ever emitted (nobody may reintroduce the
 *    branch thinking it has a live effect).
 */
import { describe, expect, it } from "vitest";
import { buildComboUsageMap } from "../../src/shared/utils/usageFilters.js";

const combos = [
  { name: "real-combo", models: ["grok/grok-3"] },
  { name: "other-combo", models: ["grok/grok-3", "glm/glm-4"] },
];

describe("buildComboUsageMap — heuristic only (CB5/NIT-4 revert)", () => {
  it("a shared member row appears under EVERY combo listing it — even with meta.combo present", () => {
    const byModel = {
      "grok-3 (grok)": { provider: "grok", rawModel: "grok-3", requests: 4, meta: { combo: "other-combo", member: "grok/grok-3" } },
    };
    const map = buildComboUsageMap(byModel, combos);
    expect(Object.keys(map).sort()).toEqual([
      "other-combo|grok-3 (grok)",
      "real-combo|grok-3 (grok)",
    ]);
    expect(map["real-combo|grok-3 (grok)"].attributed, "the attributed flag died with the branch").toBeUndefined();
  });

  it("never emits the `attributed` marker, whatever an item carries", () => {
    const byModel = {
      "grok-3 (grok)": { provider: "grok", rawModel: "grok-3", requests: 1, meta: { combo: "deleted-combo" } },
      "glm-4 (glm)": { provider: "glm", rawModel: "glm-4", requests: 1 },
    };
    const map = buildComboUsageMap(byModel, combos);
    for (const entry of Object.values(map)) expect(entry.attributed).toBeUndefined();
    // meta.combo is inert here: membership is decided by name, as always.
    expect(Object.keys(map).sort()).toEqual([
      "other-combo|glm-4 (glm)",
      "other-combo|grok-3 (grok)",
      "real-combo|grok-3 (grok)",
    ]);
  });

  it("legacy rows without meta keep the pre-CB2 contract (unchanged behavior)", () => {
    const byModel = {
      "grok-3 (grok)": { provider: "grok", rawModel: "grok-3", requests: 2 },
    };
    const map = buildComboUsageMap(byModel, combos);
    expect(Object.keys(map).sort()).toEqual([
      "other-combo|grok-3 (grok)",
      "real-combo|grok-3 (grok)",
    ]);
  });

  it("combos with zero matching usage are omitted; comboName labels every row", () => {
    const byModel = {
      "glm-4 (glm)": { provider: "glm", rawModel: "glm-4", requests: 1 },
    };
    const map = buildComboUsageMap(byModel, combos);
    expect(Object.keys(map)).toEqual(["other-combo|glm-4 (glm)"]);
    expect(map["other-combo|glm-4 (glm)"].comboName).toBe("other-combo");
  });
});
