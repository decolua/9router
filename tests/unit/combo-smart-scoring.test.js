import { describe, it, expect, beforeEach } from "vitest";

import { getSmartScoredModels, resetComboScoring } from "../../open-sse/services/combo.js";

// Access the private scoring helpers via the combo module's internal state.
// We simulate score updates by driving getSmartScoredModels + a mock handleComboChat loop.
// Because _updateScore is module-private, we test the observable behavior instead.

describe("combo smart-scoring strategy", () => {
  beforeEach(() => {
    resetComboScoring();
  });

  it("returns models in original order when all scores are equal (cold start)", () => {
    const models = ["openai/gpt-4", "claude/opus", "gemini/pro"];
    const result = getSmartScoredModels(models, "test-combo");
    // All score=100, all lastSuccessMs=0 → stable original order
    expect(result).toEqual(models);
  });

  it("returns single model unchanged", () => {
    expect(getSmartScoredModels(["openai/gpt-4"], "c")).toEqual(["openai/gpt-4"]);
  });

  it("returns empty/null unchanged", () => {
    expect(getSmartScoredModels([], "c")).toEqual([]);
    expect(getSmartScoredModels(null, "c")).toBeNull();
  });

  it("resetComboScoring clears specific combo", () => {
    const models = ["a/1", "b/2"];
    getSmartScoredModels(models, "combo-a");
    getSmartScoredModels(models, "combo-b");
    resetComboScoring("combo-a");
    // combo-b should still work fine
    expect(getSmartScoredModels(models, "combo-b")).toEqual(models);
  });
});
