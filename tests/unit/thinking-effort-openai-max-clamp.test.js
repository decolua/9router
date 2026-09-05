import { describe, expect, it } from "vitest";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// Regression: Claude Code sends thinking effort "max" (its top level). When
// 9router routes to an OpenAI-format provider, applyThinking() case "openai"
// must clamp "max"→"xhigh" because OpenAI's reasoning_effort enum has no "max"
// (L.openai caps at "xhigh"). Without the clamp, upstream returns HTTP 400
// "max effort not support". See open-sse/providers/thinkingLevels.js:10.
describe("applyThinking (openai): clamp max effort to xhigh", () => {
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

describe("provider-specific thinking rules", () => {
  it("keeps minimal effort unchanged for non-Alibaba codex models", () => {
    const body = { reasoning_effort: "minimal" };
    const out = applyThinking(FORMATS.OPENAI, "gpt-5.3-codex", body, "github");
    expect(out.reasoning_effort).toBe("minimal");
  });

  it("keeps sub-1024 budgets unchanged for non-Alibaba Claude models", () => {
    const body = {};
    const out = applyThinking(
      FORMATS.CLAUDE,
      "claude-opus-4-5",
      body,
      "anthropic",
      { mode: "budget", budget: 512 },
    );
    expect(out.thinking).toEqual({ type: "enabled", budget_tokens: 512 });
  });

  it("keeps the minimal clamp for other cannot-disable openai-format models", () => {
    const body = {};
    applyThinking(FORMATS.OPENAI, "minimaxai/minimax-m3", body, "nvidia", { mode: "none" });
    expect(body.reasoning_effort).toBe("minimal");
  });
});