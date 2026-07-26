import { describe, expect, it } from "vitest";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// Legacy OpenAI-compatible endpoints reject "max", so applyThinking() keeps
// the xhigh fallback there. Codex GPT-5.6 is the explicit exception because
// its model metadata declares max support.
describe("applyThinking (openai): preserve declared max, clamp legacy max", () => {
  it("preserves max for Codex GPT-5.6 models that explicitly support it", () => {
    const body = { reasoning: { effort: "max" } };
    const out = applyThinking(FORMATS.OPENAI_RESPONSES, "gpt-5.6-sol", body, "codex");
    expect(out.reasoning_effort).toBe("max");
  });

  it("client output_config.effort:\"max\" → reasoning_effort:\"xhigh\" (not \"max\")", () => {
    const body = { output_config: { effort: "max" } };
    const out = applyThinking(FORMATS.OPENAI, "gpt-5", body, "openai");
    expect(out.reasoning_effort).toBe("xhigh");
  });

  it("direct reasoning_effort:\"max\" clamped to \"xhigh\"", () => {
    const body = { reasoning_effort: "max" };
    const out = applyThinking(FORMATS.OPENAI, "gpt-5", body, "openai");
    expect(out.reasoning_effort).toBe("xhigh");
  });

  it("\"xhigh\" passes through unchanged (highest valid OpenAI level)", () => {
    const body = { reasoning_effort: "xhigh" };
    const out = applyThinking(FORMATS.OPENAI, "gpt-5", body, "openai");
    expect(out.reasoning_effort).toBe("xhigh");
  });

  it("\"high\" passes through unchanged", () => {
    const body = { reasoning_effort: "high" };
    const out = applyThinking(FORMATS.OPENAI, "gpt-5", body, "openai");
    expect(out.reasoning_effort).toBe("high");
  });

  it("max budget (thinking.budget_tokens:128000) → reasoning_effort:\"xhigh\" (budgetToLevel caps at xhigh)", () => {
    const body = { thinking: { type: "enabled", budget_tokens: 128000 } };
    const out = applyThinking(FORMATS.OPENAI, "gpt-5", body, "openai");
    expect(out.reasoning_effort).toBe("xhigh");
  });
});
