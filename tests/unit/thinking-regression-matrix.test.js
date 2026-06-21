/**
 * Provider-format reasoning regression matrix (9r-ocmr.e3.04).
 *
 * Comprehensive pipeline tests: input (snake_case + camelCase) → extractThinking → applyThinking → provider output.
 * Covers all provider formats, level variants, budget inputs, and negative controls.
 */

import { describe, it, expect } from "vitest";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";

const apply = (targetFormat, model, body, provider) => {
  const b = JSON.parse(JSON.stringify(body));
  applyThinking(targetFormat, model, b, provider);
  return b;
};

// ─── Negative controls: non-reasoning models ─────────────────────────

describe("Regression: non-reasoning model strips all thinking", () => {
  it("openai gpt-4o strips reasoning_effort", () => {
    const out = apply("openai", "gpt-4o", { reasoning_effort: "high" }, "openai");
    expect(out.reasoning_effort).toBeUndefined();
    expect(out.thinking).toBeUndefined();
    expect(out.output_config).toBeUndefined();
  });

  it("openai gpt-4o strips reasoningEffort (camelCase)", () => {
    const out = apply("openai", "gpt-4o", { reasoningEffort: "high" }, "openai");
    expect(out.reasoning_effort).toBeUndefined();
  });

  it("claude gpt-4o strips thinking shape", () => {
    const out = apply("claude", "gpt-4o", { thinking: { type: "enabled", budget_tokens: 4096 } }, "openai");
    expect(out.thinking).toBeUndefined();
  });
});

// ─── OpenAI format ───────────────────────────────────────────────────

describe("Regression: openai format", () => {
  it("snake_case reasoning_effort 'high'", () => {
    const out = apply("openai", "gpt-5", { reasoning_effort: "high" }, "openai");
    expect(out.reasoning_effort).toBe("high");
  });

  it("camelCase reasoningEffort 'high'", () => {
    const out = apply("openai", "gpt-5", { reasoningEffort: "high" }, "openai");
    expect(out.reasoning_effort).toBe("high");
  });

  it("nested reasoning.effort 'medium'", () => {
    const out = apply("openai", "gpt-5", { reasoning: { effort: "medium" } }, "openai");
    expect(out.reasoning_effort).toBe("medium");
  });

  it("level 'none' → reasoning_effort 'none'", () => {
    const out = apply("openai", "gpt-5", { reasoningEffort: "none" }, "openai");
    expect(out.reasoning_effort).toBe("none");
  });

  it("level 'xhigh' clamps to 'high'", () => {
    const out = apply("openai", "gpt-5", { reasoningEffort: "xhigh" }, "openai");
    expect(out.reasoning_effort).toBe("high");
  });

  it("level 'max' clamps to 'high'", () => {
    const out = apply("openai", "gpt-5", { reasoningEffort: "max" }, "openai");
    expect(out.reasoning_effort).toBe("high");
  });

  it("model suffix overrides body", () => {
    const out = apply("openai", "gpt-5(low)", { reasoningEffort: "high" }, "openai");
    expect(out.reasoning_effort).toBe("low");
  });
});

// ─── Claude adaptive format ──────────────────────────────────────────

describe("Regression: claude-adaptive format", () => {
  it("snake_case → output_config.effort", () => {
    const out = apply("claude", "claude-opus-4.7", { reasoning_effort: "high" }, "claude");
    expect(out.output_config).toEqual({ effort: "high" });
  });

  it("camelCase → output_config.effort", () => {
    const out = apply("claude", "claude-opus-4.7", { reasoningEffort: "high" }, "claude");
    expect(out.output_config).toEqual({ effort: "high" });
  });

  it("level 'none' → thinking.type disabled (canDisable)", () => {
    const out = apply("claude", "claude-opus-4.7", { reasoningEffort: "none" }, "claude");
    expect(out.thinking).toEqual({ type: "disabled" });
    expect(out.output_config).toBeUndefined();
  });

  it("existing Claude thinking shape still works", () => {
    const out = apply("claude", "claude-opus-4.7", { thinking: { type: "disabled" } }, "claude");
    expect(out.thinking).toEqual({ type: "disabled" });
  });
});

// ─── Claude budget format ────────────────────────────────────────────

describe("Regression: claude-budget format", () => {
  it("level 'high' → budget 24576", () => {
    const out = apply("claude", "claude-haiku-4.5", { reasoningEffort: "high" }, "claude");
    expect(out.thinking).toEqual({ type: "enabled", budget_tokens: 24576 });
  });

  it("level 'medium' → budget 8192", () => {
    const out = apply("claude", "claude-haiku-4.5", { reasoningEffort: "medium" }, "claude");
    expect(out.thinking).toEqual({ type: "enabled", budget_tokens: 8192 });
  });

  it("direct budget input preserved", () => {
    const out = apply("claude", "claude-haiku-4.5", { thinking: { type: "enabled", budget_tokens: 4096 } }, "claude");
    expect(out.thinking).toEqual({ type: "enabled", budget_tokens: 4096 });
  });
});

// ─── Gemini level format ─────────────────────────────────────────────

describe("Regression: gemini-level format", () => {
  it("level 'medium' → thinkingLevel 'medium'", () => {
    const out = apply("gemini", "gemini-3-pro", { reasoningEffort: "medium" }, "gemini");
    expect(out.generationConfig.thinkingConfig.thinkingLevel).toBe("medium");
  });

  it("level 'high' → thinkingLevel 'high'", () => {
    const out = apply("gemini", "gemini-3-pro", { reasoningEffort: "high" }, "gemini");
    expect(out.generationConfig.thinkingConfig.thinkingLevel).toBe("high");
  });

  it("level 'none' → thinkingLevel 'minimal' (gemini-3 cannot fully disable)", () => {
    const out = apply("gemini", "gemini-3-pro", { reasoningEffort: "none" }, "gemini");
    expect(out.generationConfig.thinkingConfig.thinkingLevel).toBe("minimal");
  });
});

// ─── Gemini budget format ────────────────────────────────────────────

describe("Regression: gemini-budget format", () => {
  it("level 'high' → thinkingBudget 24576", () => {
    const out = apply("gemini", "gemini-2.5-flash", { reasoningEffort: "high" }, "gemini");
    expect(out.generationConfig.thinkingConfig.thinkingBudget).toBe(24576);
  });

  it("direct thinkingConfig preserved", () => {
    const out = apply("gemini", "gemini-2.5-flash", { thinkingConfig: { thinkingBudget: 8192 } }, "gemini");
    expect(out.generationConfig.thinkingConfig.thinkingBudget).toBe(8192);
  });

  it("level 'none' → thinkingBudget 0", () => {
    const out = apply("gemini", "gemini-2.5-flash", { reasoningEffort: "none" }, "gemini");
    expect(out.generationConfig.thinkingConfig.thinkingBudget).toBe(0);
  });
});

// ─── Qwen format ─────────────────────────────────────────────────────

describe("Regression: qwen format", () => {
  it("level 'medium' → enable_thinking + thinking_budget 8192", () => {
    const out = apply("openai", "qwen3-max", { reasoningEffort: "medium" }, "qwen");
    expect(out.enable_thinking).toBe(true);
    expect(out.thinking_budget).toBe(8192);
  });

  it("level 'none' → enable_thinking false", () => {
    const out = apply("openai", "qwen3-max", { reasoningEffort: "none" }, "qwen");
    expect(out.enable_thinking).toBe(false);
  });

  it("QwQ cannot disable → clamp minimal", () => {
    const out = apply("openai", "qwq-32b", { reasoningEffort: "none" }, "qwen");
    expect(out.enable_thinking).toBe(true);
  });
});

// ─── DeepSeek format ─────────────────────────────────────────────────

describe("Regression: deepseek format", () => {
  it("level 'high' → thinking enabled + reasoning_effort high", () => {
    const out = apply("openai", "deepseek-v4-pro", { reasoningEffort: "high" }, "deepseek");
    expect(out.thinking).toEqual({ type: "enabled" });
    expect(out.reasoning_effort).toBe("high");
  });

  it("level 'low' → reasoning_effort high (low/medium→high)", () => {
    const out = apply("openai", "deepseek-v4-pro", { reasoningEffort: "low" }, "deepseek");
    expect(out.reasoning_effort).toBe("high");
  });

  it("level 'xhigh' → reasoning_effort max", () => {
    const out = apply("openai", "deepseek-v4-pro", { reasoningEffort: "xhigh" }, "deepseek");
    expect(out.reasoning_effort).toBe("max");
  });
});

// ─── Kimi format ─────────────────────────────────────────────────────

describe("Regression: kimi format", () => {
  it("level 'high' → reasoning_effort high", () => {
    const out = apply("openai", "kimi-k2.6", { reasoningEffort: "high" }, "kimi");
    expect(out.reasoning_effort).toBe("high");
  });

  it("level 'max' → reasoning_effort high (max clamped)", () => {
    const out = apply("openai", "kimi-k2.6", { reasoningEffort: "max" }, "kimi");
    expect(out.reasoning_effort).toBe("high");
  });
});

// ─── MiniMax format ──────────────────────────────────────────────────

describe("Regression: minimax format", () => {
  it("any effort → thinking.type adaptive", () => {
    const out = apply("claude", "MiniMax-M3", { reasoningEffort: "high" }, "minimax");
    expect(out.thinking).toEqual({ type: "adaptive" });
  });

  it("non-disableable model (M2.7) → adaptive even when disabled", () => {
    const out = apply("claude", "MiniMax-M2.7", { thinking: { type: "disabled" } }, "minimax");
    expect(out.thinking.type).toBe("adaptive");
  });
});

// ─── camelCase vs snake_case equivalence ─────────────────────────────

describe("Regression: camelCase and snake_case produce identical output fields", () => {
  const cases = [
    { model: "gpt-5", target: "openai", prov: "openai", field: "reasoning_effort" },
    { model: "claude-opus-4.7", target: "claude", prov: "claude", field: "output_config" },
    { model: "gemini-3-pro", target: "gemini", prov: "gemini", field: "generationConfig" },
    { model: "deepseek-v4-pro", target: "openai", prov: "deepseek", field: "thinking" },
    { model: "kimi-k2.6", target: "openai", prov: "kimi", field: "reasoning_effort" },
  ];

  for (const { model, target, prov, field } of cases) {
    it(`${prov}/${model}: camelCase ≡ snake_case (provider output)`, () => {
      const snake = apply(target, model, { reasoning_effort: "high" }, prov);
      const camel = apply(target, model, { reasoningEffort: "high" }, prov);
      // Compare only the provider-specific output field (original input field is preserved)
      expect(camel[field]).toEqual(snake[field]);
    });
  }
});
