/**
 * Characterization tests for runtime reasoning alias normalization.
 *
 * Bead: 9r-ocmr.e3.01
 * PRD:  REQ-010..012, VAL-010..012
 *
 * These tests document the CURRENT behavior (snake_case extraction) and
 * define the TARGET behavior (camelCase alias support) for the thinking
 * normalizer in open-sse/translator/concerns/thinkingUnified.js.
 *
 * Red-green workflow:
 *   - "CURRENT" tests should PASS before implementation
 *   - "TARGET" tests should FAIL before implementation (red)
 *   - After implementation, all tests should PASS (green)
 */

import { describe, it, expect } from "vitest";
import {
  extractThinking,
  applyThinking,
} from "../../open-sse/translator/concerns/thinkingUnified.js";

// Helper: apply thinking with body clone
const apply = (targetFormat, model, body, provider) => {
  const b = JSON.parse(JSON.stringify(body));
  applyThinking(targetFormat, model, b, provider);
  return b;
};

// ─── CURRENT BEHAVIOR: snake_case extraction ─────────────────────────

describe("extractThinking — CURRENT: snake_case provider-native shapes", () => {
  it("extracts reasoning_effort (OpenAI snake_case)", () => {
    expect(extractThinking({ reasoning_effort: "high" })).toEqual({
      mode: "level",
      level: "high",
    });
  });

  it("extracts reasoning.effort (OpenAI nested)", () => {
    expect(extractThinking({ reasoning: { effort: "medium" } })).toEqual({
      mode: "level",
      level: "medium",
    });
  });

  it("extracts thinking (Claude shape)", () => {
    expect(extractThinking({ thinking: { type: "enabled", budget_tokens: 4096 } })).toEqual({
      mode: "budget",
      budget: 4096,
    });
  });

  it("extracts output_config.effort (Claude adaptive)", () => {
    expect(extractThinking({ output_config: { effort: "high" } })).toEqual({
      mode: "level",
      level: "high",
    });
  });

  it("extracts thinkingConfig (Gemini)", () => {
    expect(extractThinking({ thinkingConfig: { thinkingBudget: 8192 } })).toEqual({
      mode: "budget",
      budget: 8192,
    });
  });

  it("extracts enable_thinking (Qwen snake_case)", () => {
    expect(extractThinking({ enable_thinking: true, thinking_budget: 1024 })).toEqual({
      mode: "budget",
      budget: 1024,
    });
  });

  it("returns null when no thinking intent present", () => {
    expect(extractThinking({ messages: [{ role: "user", content: "hi" }] })).toBeNull();
  });
});

// ─── TARGET BEHAVIOR: camelCase alias extraction ─────────────────────

describe("extractThinking — TARGET: camelCase aliases (OpenCode SDK)", () => {
  it("extracts reasoningEffort (camelCase alias for reasoning_effort)", () => {
    // TARGET: OpenCode sends reasoningEffort (camelCase)
    const result = extractThinking({ reasoningEffort: "high" });
    expect(result).toEqual({ mode: "level", level: "high" });
  });

  it("camelCase reasoningEffort takes precedence over snake_case reasoning_effort", () => {
    // When both are present, camelCase (OpenCode) should win
    const result = extractThinking({
      reasoningEffort: "low",
      reasoning_effort: "high",
    });
    expect(result).toEqual({ mode: "level", level: "low" });
  });

  it("camelCase reasoningEffort with none/off value", () => {
    const result = extractThinking({ reasoningEffort: "none" });
    expect(result).toEqual({ mode: "none" });
  });

  it("camelCase reasoningEffort with auto value", () => {
    const result = extractThinking({ reasoningEffort: "auto" });
    expect(result).toEqual({ mode: "auto" });
  });

  it("camelCase reasoningEffort is case-insensitive", () => {
    expect(extractThinking({ reasoningEffort: "High" })).toEqual({
      mode: "level",
      level: "high",
    });
  });

  it("Claude thinking shape takes precedence over camelCase reasoningEffort", () => {
    // Provider-native shapes are more specific than generic aliases.
    // When both are present, the provider-native shape wins.
    const result = extractThinking({
      reasoningEffort: "medium",
      thinking: { type: "enabled", budget_tokens: 8192 },
    });
    expect(result).toEqual({ mode: "budget", budget: 8192 });
  });

  it("camelCase reasoningEffort overrides Gemini shape", () => {
    const result = extractThinking({
      reasoningEffort: "low",
      thinkingConfig: { thinkingBudget: 24576 },
    });
    expect(result).toEqual({ mode: "level", level: "low" });
  });
});

// ─── TARGET BEHAVIOR: applyThinking with camelCase input ─────────────

describe("applyThinking — TARGET: camelCase input flows through correctly", () => {
  it("OpenAI format: reasoningEffort → reasoning_effort", () => {
    const out = apply("openai", "gpt-5", { reasoningEffort: "high" }, "openai");
    expect(out.reasoning_effort).toBe("high");
  });

  it("Claude adaptive: reasoningEffort → output_config.effort", () => {
    const out = apply("claude", "claude-opus-4.7", { reasoningEffort: "high" }, "claude");
    expect(out.output_config).toEqual({ effort: "high" });
  });

  it("Gemini budget: reasoningEffort → thinkingConfig.thinkingBudget", () => {
    const out = apply("gemini", "gemini-2.5-flash", { reasoningEffort: "high" }, "gemini");
    expect(out.generationConfig.thinkingConfig.thinkingBudget).toBe(24576);
  });

  it("Qwen: reasoningEffort → enable_thinking + thinking_budget", () => {
    const out = apply("openai", "qwen3-max", { reasoningEffort: "medium" }, "qwen");
    expect(out.enable_thinking).toBe(true);
    expect(out.thinking_budget).toBe(8192);
  });

  it("DeepSeek: reasoningEffort → thinking + reasoning_effort", () => {
    const out = apply("openai", "deepseek-v4-pro", { reasoningEffort: "high" }, "deepseek");
    expect(out.thinking).toEqual({ type: "enabled" });
    expect(out.reasoning_effort).toBe("high");
  });
});
