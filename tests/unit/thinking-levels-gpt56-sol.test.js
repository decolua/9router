import { describe, it, expect } from "vitest";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";

// #4031: `none` is gone from every GPT-5.6 list below. OpenAI's reasoning
// models reject `reasoning_effort: "none"` outright, so the capability
// entries now carry `thinkingCanDisable: false` and getThinkingLevels filters
// the value it cannot honour. What this file is actually pinning -- Codex
// levels differ from Kiro's, sol/terra carry `ultra` and luna does not -- is
// unchanged.
describe("getThinkingLevels", () => {
  it.each([
    ["gpt-5.6-sol", ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"]],
    ["gpt-5.6-terra", ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"]],
    ["gpt-5.6-luna", ["minimal", "low", "medium", "high", "xhigh", "max"]],
    ["gpt-5.6-sol-review", ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"]],
    ["gpt-5.6-terra-review", ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"]],
    ["gpt-5.6-luna-review", ["minimal", "low", "medium", "high", "xhigh", "max"]],
  ])("returns Codex levels for %s", (model, expected) => {
    expect(getThinkingLevels("codex", model)).toEqual(expected);
  });

  it("does not expose Codex-only GPT-5.6 overrides on Kiro", () => {
    expect(getThinkingLevels("kiro", "gpt-5.6-sol")).toEqual([
      "minimal", "low", "medium", "high", "xhigh",
    ]);
  });

  it("does not add max for other codex models", () => {
    const levels = getThinkingLevels("codex", "gpt-5.3-codex");
    expect(levels).toEqual(["low", "medium", "high", "xhigh"]);
  });

  it("does not add max for other Codex models", () => {
    const levels = getThinkingLevels("codex", "gpt-5.5");
    expect(levels || []).not.toContain("max");
  });
});
