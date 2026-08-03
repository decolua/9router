import { describe, it, expect } from "vitest";
import { supportsThinkingLevel } from "../../open-sse/providers/capabilities.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";

describe("getThinkingLevels", () => {
  it.each(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"])("adds max for %s on codex", (model) => {
    const levels = getThinkingLevels("codex", model);
    expect(levels).toContain("max");
    expect(levels).toContain("xhigh");
    expect(levels).not.toContain("ultra");
    expect(supportsThinkingLevel("codex", model, "max")).toBe(true);
  });

  it("does not add max for other codex models", () => {
    const levels = getThinkingLevels("codex", "gpt-5.3-codex");
    expect(levels).toEqual(["low", "medium", "high", "xhigh"]);
  });

  it.each(["openai", "kiro"])("does not add codex-only max for %s", (provider) => {
    expect(supportsThinkingLevel(provider, "gpt-5.6-sol", "max")).toBe(false);
  });
});
