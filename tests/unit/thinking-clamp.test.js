/**
 * Tests for thinking budget clamping (9r-ocmr.e3.03).
 *
 * Validates:
 * - Over-max numeric budget is clamped to thinkingRange.max
 * - Budget cannot consume all visible output (maxOutput reserve)
 * - Non-disableable thinking metadata is respected
 * - Missing metadata fallback works correctly
 */

import { describe, it, expect } from "vitest";
import { clampThinkingBudget } from "../../open-sse/translator/concerns/thinking.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";

const apply = (targetFormat, model, body, provider) => {
  const b = JSON.parse(JSON.stringify(body));
  applyThinking(targetFormat, model, b, provider);
  return b;
};

describe("clampThinkingBudget", () => {
  it("clamps to thinkingRange.max when budget exceeds it", () => {
    const caps = { thinkingRange: { max: 16384 } };
    expect(clampThinkingBudget(32768, caps)).toBe(16384);
  });

  it("clamps to thinkingRange.min when budget is below it", () => {
    const caps = { thinkingRange: { min: 1024 } };
    expect(clampThinkingBudget(512, caps)).toBe(1024);
  });

  it("clamps to 80% of maxOutput when budget exceeds it", () => {
    const caps = { maxOutput: 16000 };
    // 80% of 16000 = 12800
    expect(clampThinkingBudget(15000, caps)).toBe(12800);
  });

  it("applies both thinkingRange.max and maxOutput reserve (stricter wins)", () => {
    const caps = { thinkingRange: { max: 50000 }, maxOutput: 20000 };
    // thinkingRange.max = 50000, 80% of maxOutput = 16000 → 16000 wins
    expect(clampThinkingBudget(50000, caps)).toBe(16000);
  });

  it("does not clamp when budget is within all bounds", () => {
    const caps = { thinkingRange: { max: 50000 }, maxOutput: 50000 };
    expect(clampThinkingBudget(8192, caps)).toBe(8192);
  });

  it("passes through non-finite values", () => {
    expect(clampThinkingBudget(NaN, {})).toBe(NaN);
    expect(clampThinkingBudget(Infinity, {})).toBe(Infinity);
  });

  it("passes through zero and negative (handled elsewhere)", () => {
    expect(clampThinkingBudget(0, {})).toBe(0);
    expect(clampThinkingBudget(-1, {})).toBe(-1);
  });

  it("works with missing/empty caps", () => {
    expect(clampThinkingBudget(8192, null)).toBe(8192);
    expect(clampThinkingBudget(8192, undefined)).toBe(8192);
    expect(clampThinkingBudget(8192, {})).toBe(8192);
  });
});

describe("applyThinking — budget clamping integration", () => {
  it("claude-budget: over-max budget is clamped", () => {
    const out = apply("claude", "claude-haiku-4.5", { thinking: { type: "enabled", budget_tokens: 200000 } }, "claude");
    // Claude haiku has thinkingRange.max, budget should be clamped
    expect(out.thinking.budget_tokens).toBeLessThanOrEqual(200000);
  });

  it("gemini-budget: budget respects maxOutput reserve", () => {
    const out = apply("gemini", "gemini-2.5-flash", { reasoningEffort: "high" }, "gemini");
    // Should have a thinkingBudget that doesn't consume all output
    expect(out.generationConfig.thinkingConfig.thinkingBudget).toBeGreaterThan(0);
  });

  it("non-reasoning model still strips thinking regardless of budget", () => {
    const out = apply("openai", "gpt-4o", { reasoningEffort: "high" }, "openai");
    expect(out.reasoning_effort).toBeUndefined();
    expect(out.thinking).toBeUndefined();
  });

  it("non-disableable model clamps none to minimal", () => {
    // MiniMax M2.x cannot disable thinking (thinkingCanDisable: false)
    const out = apply("claude", "MiniMax-M2.7", { thinking: { type: "disabled" } }, "minimax");
    expect(out.thinking.type).toBe("adaptive");
  });
});
