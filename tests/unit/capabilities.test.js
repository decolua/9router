import { describe, expect, it } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

describe("getCapabilitiesForModel", () => {
  const claudeSonnet5Expected = {
    contextWindow: 1000000,
    maxOutput: 128000,
    thinkingFormat: "claude-adaptive",
    reasoning: true,
    vision: true,
    search: true,
  };

  const kiroGpt56Expected = {
    contextWindow: 272000,
    maxOutput: 128000,
    thinkingFormat: "openai",
    reasoning: true,
    vision: true,
    search: true,
  };

  it("reports Kiro Claude Opus 5 variants as 1M adaptive-thinking models", () => {
    for (const model of [
      "claude-opus-5",
      "anthropic/claude-opus-5",
      "claude-opus-5-thinking",
      "claude-opus-5-agentic",
      "claude-opus-5-thinking-agentic",
    ]) {
      expect(getCapabilitiesForModel("kiro", model)).toMatchObject(claudeSonnet5Expected);
    }
  });

  it("reports Claude Fable 5.1 as a permanent adaptive-thinking model", () => {
    expect(getCapabilitiesForModel("claude", "claude-fable-5-1")).toMatchObject({
      ...claudeSonnet5Expected,
      thinkingCanDisable: false,
    });
  });

  it("reports Kiro Claude Opus 4.8 as a 1M context model", () => {
    expect(getCapabilitiesForModel("kiro", "claude-opus-4.8").contextWindow).toBe(1000000);
    expect(getCapabilitiesForModel("kiro", "anthropic/claude-opus-4.8").contextWindow).toBe(1000000);
    expect(getCapabilitiesForModel("kiro", "claude-opus-4-8").contextWindow).toBe(1000000);
    expect(getCapabilitiesForModel("kiro", "claude-opus-4.8-thinking").contextWindow).toBe(1000000);
    expect(getCapabilitiesForModel("kiro", "claude-opus-4-8-thinking").contextWindow).toBe(1000000);
  });

  it("reports Kiro Claude Sonnet 5 as a 1M adaptive-thinking model", () => {
    expect(getCapabilitiesForModel("kiro", "claude-sonnet-5")).toMatchObject(claudeSonnet5Expected);
    expect(getCapabilitiesForModel("kiro", "anthropic/claude-sonnet-5")).toMatchObject(claudeSonnet5Expected);
    expect(getCapabilitiesForModel("kiro", "claude-sonnet-5-thinking")).toMatchObject(claudeSonnet5Expected);
    expect(getCapabilitiesForModel("kiro", "claude-sonnet-5-agentic")).toMatchObject(claudeSonnet5Expected);
    expect(getCapabilitiesForModel("kiro", "claude-sonnet-5-thinking-agentic")).toMatchObject(claudeSonnet5Expected);
  });

  it("reports Kiro GPT 5.6 models with the Kiro 272k context window", () => {
    expect(getCapabilitiesForModel("kiro", "gpt-5.6-sol")).toMatchObject(kiroGpt56Expected);
    expect(getCapabilitiesForModel("kiro", "openai/gpt-5.6-sol")).toMatchObject(kiroGpt56Expected);
    expect(getCapabilitiesForModel("kiro", "gpt-5.6-terra-thinking")).toMatchObject(kiroGpt56Expected);
    expect(getCapabilitiesForModel("kiro", "gpt-5.6-luna-agentic")).toMatchObject(kiroGpt56Expected);
    expect(getCapabilitiesForModel("kiro", "gpt-5.6-sol-thinking-agentic")).toMatchObject(kiroGpt56Expected);
  });

  it("reports Codex GPT 6.0 Astra as a vision and thinking capable model", () => {
    expect(getCapabilitiesForModel("codex", "gpt-6-astra")).toMatchObject({
      vision: true,
      reasoning: true,
      search: true,
      thinkingFormat: "openai",
      contextWindow: 272000,
      maxOutput: 128000,
    });
  });

  // Regression: "solar-pro4" contains "o4", and PATTERN_CAPABILITIES resolves
  // first-match-wins. Before the Cline patterns were declared ahead of the
  // o-series catch-alls, Solar Pro 4 inherited the o-series vision flag and a
  // 100k output ceiling, so the router advertised image input for a model whose
  // upstream answers with "No endpoints found that support image input".
  it("does not let the o-series catch-alls capture Cline Solar Pro 4", () => {
    for (const model of ["solar-pro4", "upstage/solar-pro4", "cline-free/solar-pro4"]) {
      const caps = getCapabilitiesForModel("cline", model);
      expect(caps.vision).toBe(false);
      expect(caps.maxOutput).toBe(32000);
      expect(caps.contextWindow).toBe(200000);
      expect(caps.reasoning).toBe(true);
    }
  });

  it("reports Cline LongCat 2.0 with its own caps, not the o-series ones", () => {
    for (const model of ["longcat-2.0", "private/longcat-2.0", "cline-free/longcat-2.0"]) {
      const caps = getCapabilitiesForModel("cline", model);
      expect(caps.vision).toBe(false);
      expect(caps.maxOutput).toBe(32000);
      expect(caps.reasoning).toBe(true);
    }
  });

  it("still reports the real OpenAI o-series as vision-capable", () => {
    for (const model of ["o1", "o3", "o3-mini", "o4-mini", "openai/o4-mini"]) {
      const caps = getCapabilitiesForModel("openai", model);
      expect(caps.vision).toBe(true);
      expect(caps.maxOutput).toBe(100000);
      expect(caps.contextWindow).toBe(200000);
    }
  });
});
