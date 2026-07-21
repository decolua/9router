import { describe, it, expect } from "vitest";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";

describe("getThinkingLevels", () => {
  it.each(["sol", "terra", "luna"])("adds max for gpt-5.6-%s on codex", (variant) => {
    const levels = getThinkingLevels("codex", `gpt-5.6-${variant}`);
    expect(levels).toEqual(["none", "low", "medium", "high", "xhigh", "max"]);
    expect(levels).not.toContain("ultra");
  });

  it("does not add max for other codex models", () => {
    const levels = getThinkingLevels("codex", "gpt-5.3-codex");
    expect(levels).toEqual(["low", "medium", "high", "xhigh"]);
  });

  it("does not add max for legacy gpt models", () => {
    const levels = getThinkingLevels("codex", "gpt-5.5");
    expect(levels || []).not.toContain("max");
  });
});
