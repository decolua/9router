import { describe, it, expect } from "vitest";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";

describe("getThinkingLevels", () => {
  it("adds max for gpt-5.6-sol on codex", () => {
    const levels = getThinkingLevels("codex", "gpt-5.6-sol");
    expect(levels).toContain("max");
    expect(levels).toContain("xhigh");
    expect(levels).not.toContain("ultra");
  });

  it("does not add max for other codex models", () => {
    const levels = getThinkingLevels("codex", "gpt-5.3-codex");
    expect(levels).toEqual(["low", "medium", "high", "xhigh"]);
  });

  it("does not add max for other gpt-5.6 models", () => {
    const levels = getThinkingLevels("codex", "gpt-5.5");
    expect(levels || []).not.toContain("max");
  });
});
