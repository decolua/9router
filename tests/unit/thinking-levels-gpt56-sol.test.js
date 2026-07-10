import { describe, it, expect } from "vitest";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";

// GPT-5.6 effort matrix (metadata must match wire):
// Sol/Terra → max + ultra; Luna → max (no ultra); older/unrelated → neither.
describe("getThinkingLevels GPT-5.6 effort matrix", () => {
  it("gpt-5.6-sol exposes max and ultra (and keeps xhigh)", () => {
    const levels = getThinkingLevels("codex", "gpt-5.6-sol");
    expect(levels).toContain("max");
    expect(levels).toContain("ultra");
    expect(levels).toContain("xhigh");
  });

  it("gpt-5.6-terra exposes max and ultra", () => {
    const levels = getThinkingLevels("openai", "gpt-5.6-terra");
    expect(levels).toContain("max");
    expect(levels).toContain("ultra");
    expect(levels).toContain("xhigh");
  });

  it("gpt-5.6-luna exposes max but not ultra", () => {
    const levels = getThinkingLevels("openai", "gpt-5.6-luna");
    expect(levels).toContain("max");
    expect(levels).toContain("xhigh");
    expect(levels).not.toContain("ultra");
  });

  it("does not add max/ultra for other codex models", () => {
    const levels = getThinkingLevels("codex", "gpt-5.3-codex");
    expect(levels).toEqual(["low", "medium", "high", "xhigh"]);
  });

  it("does not add max/ultra for older openai models", () => {
    const levels = getThinkingLevels("openai", "gpt-5");
    expect(levels).not.toContain("max");
    expect(levels).not.toContain("ultra");
    expect(levels).toEqual(["none", "minimal", "low", "medium", "high", "xhigh"]);
  });

  it("does not add max/ultra for gpt-5.5", () => {
    const levels = getThinkingLevels("codex", "gpt-5.5");
    expect(levels || []).not.toContain("max");
    expect(levels || []).not.toContain("ultra");
  });
});
