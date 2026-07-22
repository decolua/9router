import { describe, it, expect } from "vitest";
import { getThinkingLevels, supportsThinkingLevel } from "../../open-sse/providers/thinkingLevels.js";

describe("getThinkingLevels", () => {
  it.each(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"])("adds max for %s on codex", (model) => {
    const levels = getThinkingLevels("codex", model);
    expect(levels).toContain("max");
    expect(levels).toContain("xhigh");
    expect(levels).not.toContain("ultra");
  });

  it.each(["gpt-5.6", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"])("adds max for %s on OpenAI", (model) => {
    expect(supportsThinkingLevel("openai", model, "max")).toBe(true);
  });

  it("does not add max for other codex models", () => {
    const levels = getThinkingLevels("codex", "gpt-5.3-codex");
    expect(levels).toEqual(["low", "medium", "high", "xhigh"]);
  });

  it.each([
    ["codex", "gpt-5.5"],
    ["openai", "gpt-5.5"],
    ["kiro", "gpt-5.6-sol"],
  ])("does not add max for %s/%s", (provider, model) => {
    expect(supportsThinkingLevel(provider, model, "max")).toBe(false);
  });
});
