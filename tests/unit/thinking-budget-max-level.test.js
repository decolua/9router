import { describe, expect, it } from "vitest";
import { budgetToLevel } from "../../open-sse/translator/concerns/thinking.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// Reverse map must be able to reach "max": LEVEL_TO_BUDGET.max = 128000 and
// xhigh = 32768, so the xhigh/max threshold is their midpoint (80384).
// Previously any budget > 28672 collapsed to "xhigh", making "max"
// unreachable from Claude Code budget_tokens — its default thinking budget
// (MAX_THINKING_TOKENS) could never produce effort "max".
describe("budgetToLevel reaches max tier", () => {
  it("budget 98304 → \"max\"", () => {
    expect(budgetToLevel(98304)).toBe("max");
  });

  it("budget 128000 → \"max\"", () => {
    expect(budgetToLevel(128000)).toBe("max");
  });

  it("budget 80385 → \"max\" (just above midpoint)", () => {
    expect(budgetToLevel(80385)).toBe("max");
  });

  it("budget 80384 → \"xhigh\" (midpoint still xhigh)", () => {
    expect(budgetToLevel(80384)).toBe("xhigh");
  });

  it("budget 31999 stays \"xhigh\"", () => {
    expect(budgetToLevel(31999)).toBe("xhigh");
  });
});

describe("applyThinking (openai-responses): large budgets map to max effort", () => {
  it("budget 98304 → reasoning_effort \"max\" for gpt-5.6-sol (openai wire)", () => {
    const body = { thinking: { type: "enabled", budget_tokens: 98304 } };
    const out = applyThinking(FORMATS.OPENAI_RESPONSES, "gpt-5.6-sol", body, "codex");
    expect(out?.reasoning_effort).toBe("max");
  });
});
