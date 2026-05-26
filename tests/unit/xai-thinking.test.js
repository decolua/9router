import { describe, it, expect } from "vitest";
import {
  applyThinking,
  budgetToEffort,
} from "../../src/lib/providers/xai/thinking.js";

describe("xai/thinking budgetToEffort", () => {
  it("maps 0 / negative to undefined", () => {
    expect(budgetToEffort(0)).toBeUndefined();
    expect(budgetToEffort(-100)).toBeUndefined();
    expect(budgetToEffort(NaN)).toBeUndefined();
  });
  it("maps small budgets to low", () => {
    expect(budgetToEffort(1)).toBe("low");
    expect(budgetToEffort(3999)).toBe("low");
  });
  it("maps medium budgets to medium", () => {
    expect(budgetToEffort(4000)).toBe("medium");
    expect(budgetToEffort(15999)).toBe("medium");
  });
  it("maps large budgets to high", () => {
    expect(budgetToEffort(16000)).toBe("high");
    expect(budgetToEffort(64000)).toBe("high");
  });
});

describe("xai/thinking applyThinking", () => {
  it("returns input untouched when nothing matches", () => {
    const req = { model: "grok-4", input: [] };
    const out = applyThinking(req);
    expect(out).toEqual(req);
    expect(out).not.toBe(req); // cloned
  });

  it("honors xAI-native reasoning.effort verbatim", () => {
    const req = { reasoning: { effort: "high" }, foo: 1 };
    const out = applyThinking(req);
    expect(out.reasoning).toEqual({ effort: "high" });
    expect(out.foo).toBe(1);
  });

  it("rewrites OpenAI Chat reasoning_effort into reasoning.effort", () => {
    const req = { reasoning_effort: "medium" };
    const out = applyThinking(req);
    expect(out.reasoning).toEqual({ effort: "medium" });
    expect(out.reasoning_effort).toBeUndefined();
  });

  it("ignores invalid reasoning_effort values", () => {
    const req = { reasoning_effort: "ultra" };
    const out = applyThinking(req);
    expect(out.reasoning).toBeUndefined();
  });

  it("maps Anthropic thinking enabled with budget_tokens", () => {
    const req = { thinking: { type: "enabled", budget_tokens: 20000 } };
    const out = applyThinking(req);
    expect(out.reasoning).toEqual({ effort: "high" });
    expect(out.thinking).toBeUndefined();
  });

  it("defaults Anthropic thinking enabled without budget_tokens to medium", () => {
    const req = { thinking: { type: "enabled" } };
    const out = applyThinking(req);
    expect(out.reasoning).toEqual({ effort: "medium" });
  });

  it("strips Anthropic thinking type=disabled without setting reasoning", () => {
    const req = { thinking: { type: "disabled" } };
    const out = applyThinking(req);
    expect(out.reasoning).toBeUndefined();
    expect(out.thinking).toBeUndefined();
  });

  it("maps Gemini thinkingConfig.thinkingBudget", () => {
    const req = { thinkingConfig: { thinkingBudget: 5000 } };
    const out = applyThinking(req);
    expect(out.reasoning).toEqual({ effort: "medium" });
    expect(out.thinkingConfig).toBeUndefined();
  });

  it("strips Gemini thinkingConfig with budget=0 without setting reasoning", () => {
    const req = { thinkingConfig: { thinkingBudget: 0 } };
    const out = applyThinking(req);
    expect(out.reasoning).toBeUndefined();
    expect(out.thinkingConfig).toBeUndefined();
  });

  it("applies defaultEffort when nothing else is provided", () => {
    const out = applyThinking({}, { defaultEffort: "low" });
    expect(out.reasoning).toEqual({ effort: "low" });
  });
});
