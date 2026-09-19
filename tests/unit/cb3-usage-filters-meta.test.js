/**
 * CB3 — buildComboUsageMap must TRUST a recorded meta.combo (CB2+ lines) and
 * only fall back to the name heuristic for legacy rows without attribution.
 * The heuristic assigns one row to EVERY combo sharing the member (RC1 Q1) —
 * once the truth exists it must never be second-guessed.
 */
import { describe, expect, it } from "vitest";
import { buildComboUsageMap } from "../../src/shared/utils/usageFilters.js";

const combos = [
  { name: "real-combo", models: ["grok/grok-3"] },
  { name: "other-combo", models: ["grok/grok-3", "glm/glm-4"] },
];

describe("buildComboUsageMap — meta.combo priority", () => {
  it("attributes a meta.combo row ONLY to the combo it actually ran in", () => {
    const byModel = {
      "grok-3 (grok)": { provider: "grok", rawModel: "grok-3", requests: 4, meta: { combo: "other-combo", member: "grok/grok-3" } },
    };
    const map = buildComboUsageMap(byModel, combos);
    const keys = Object.keys(map);
    expect(keys).toEqual(["other-combo|grok-3 (grok)"]);
    expect(map[keys[0]].attributed).toBe(true);
    expect(map["real-combo|grok-3 (grok)"], "shared member must not steal the row").toBeUndefined();
  });

  it("drops a meta.combo row whose combo no longer exists in config", () => {
    const byModel = {
      "grok-3 (grok)": { provider: "grok", rawModel: "grok-3", requests: 1, meta: { combo: "deleted-combo" } },
    };
    expect(Object.keys(buildComboUsageMap(byModel, combos))).toEqual([]);
  });

  it("keeps the legacy heuristic for rows WITHOUT meta.combo (unchanged behavior)", () => {
    const byModel = {
      "grok-3 (grok)": { provider: "grok", rawModel: "grok-3", requests: 2 },
    };
    const map = buildComboUsageMap(byModel, combos);
    // Pre-CB2 contract: one row appears under every combo listing the member.
    expect(Object.keys(map).sort()).toEqual([
      "other-combo|grok-3 (grok)",
      "real-combo|grok-3 (grok)",
    ]);
    expect(map["real-combo|grok-3 (grok)"].attributed, "legacy rows are inferred, not attributed").toBeFalsy();
  });

  it("falls back to the heuristic when meta.combo is not a usable string", () => {
    const byModel = {
      "grok-3 (grok)": { provider: "grok", rawModel: "grok-3", requests: 1, meta: { combo: "" } },
      "glm-4 (glm)": { provider: "glm", rawModel: "glm-4", requests: 1, meta: { member: "glm/glm-4" } },
    };
    const map = buildComboUsageMap(byModel, combos);
    expect(Object.keys(map).sort()).toEqual([
      "other-combo|glm-4 (glm)",
      "other-combo|grok-3 (grok)",
      "real-combo|grok-3 (grok)",
    ]);
  });
});
