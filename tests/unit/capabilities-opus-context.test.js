import { describe, expect, it } from "vitest";

import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

// Claude Opus 4.6+ ships a 1M-token context window (GA, standard pricing).
// The registry exposes dashed ids (claude-opus-4-8, claude-opus-4-7), which
// must resolve to the 1M context + adaptive thinking caps rather than falling
// through to the generic *claude*opus* pattern (200k / budget thinking).
describe("Claude Opus 1M context capabilities", () => {
  const expected = {
    contextWindow: 1000000,
    maxOutput: 128000,
    thinkingFormat: "claude-adaptive",
    reasoning: true,
    vision: true,
    search: true,
  };

  for (const model of [
    "claude-opus-4-8",
    "claude-opus-4.8",
    "claude-opus-4-7",
    "claude-opus-4.7",
    "claude-opus-4-6",
  ]) {
    it(`resolves ${model} to a 1M context window`, () => {
      expect(getCapabilitiesForModel("cc", model)).toMatchObject(expected);
    });
  }

  it("keeps the older Opus 4.5 at the standard 200k context", () => {
    expect(getCapabilitiesForModel("cc", "claude-opus-4-5-20251101").contextWindow).toBe(200000);
  });
});
