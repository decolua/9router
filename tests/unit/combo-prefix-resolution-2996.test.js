// Issue #2996 — Combo referenced with a provider prefix (e.g. `openrouter/lordx.1`)
// was sent verbatim to the upstream provider because getComboModelsFromData bailed
// out on any model string containing "/". It must strip the prefix and resolve to
// the combo's member models.

import { describe, expect, it } from "vitest";
import { getComboModelsFromData } from "../../open-sse/services/combo.js";

const COMBOS = [
  { name: "lordx.1", models: ["openrouter/nemotron-3-super", "openrouter/nemotron-3-ultra"] },
  { name: "plaincombo", models: ["deepseek/chat"] },
];

describe("getComboModelsFromData prefix resolution (#2996)", () => {
  it("resolves a combo referenced with a provider prefix", () => {
    const models = getComboModelsFromData("openrouter/lordx.1", COMBOS);
    expect(models).toEqual(["openrouter/nemotron-3-super", "openrouter/nemotron-3-ultra"]);
  });

  it("still resolves a bare combo name", () => {
    const models = getComboModelsFromData("plaincombo", COMBOS);
    expect(models).toEqual(["deepseek/chat"]);
  });

  it("returns null for a real provider/model that is not a combo", () => {
    const models = getComboModelsFromData("openai/gpt-4o", COMBOS);
    expect(models).toBeNull();
  });

  it("returns null for an unknown combo", () => {
    const models = getComboModelsFromData("openrouter/nope.9", COMBOS);
    expect(models).toBeNull();
  });

  it("handles object-format combosData", () => {
    const models = getComboModelsFromData("lordx.1", { combos: COMBOS });
    expect(models).toEqual(["openrouter/nemotron-3-super", "openrouter/nemotron-3-ultra"]);
  });
});
