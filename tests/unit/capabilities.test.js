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

  // Anthropic rejects thinking.type "enabled" on 4.6+ generation models outright, so a
  // budget format turns every thinking request into a 400. Fable/Mythos are newer than
  // 4.6 and must follow the adaptive rule.
  it("reports Claude Fable / Mythos as adaptive-thinking models", () => {
    for (const provider of ["github", "claude"]) {
      expect(getCapabilitiesForModel(provider, "claude-fable-5").thinkingFormat).toBe("claude-adaptive");
      expect(getCapabilitiesForModel(provider, "claude-mythos-1").thinkingFormat).toBe("claude-adaptive");
    }
  });

  // Live provider catalogs ship claude-* variants ahead of the static model lists;
  // anything falling through to the generic "*claude*sonnet*" pattern gets the 4.5-era
  // budget format and breaks.
  it("keeps unlisted Sonnet 5 variants on the adaptive format", () => {
    expect(getCapabilitiesForModel("github", "claude-sonnet-5.1").thinkingFormat).toBe("claude-adaptive");
    expect(getCapabilitiesForModel("github", "claude-sonnet-5-preview").thinkingFormat).toBe("claude-adaptive");
  });

  // 4.5 and older stay on the budget format — they reject output_config.effort.
  it("keeps pre-4.6 Claude models on the budget format", () => {
    expect(getCapabilitiesForModel("github", "claude-haiku-4.5").thinkingFormat).toBe("claude-budget");
    expect(getCapabilitiesForModel("github", "claude-sonnet-4.5").thinkingFormat).toBe("claude-budget");
    expect(getCapabilitiesForModel("github", "claude-opus-4.5").thinkingFormat).toBe("claude-budget");
  });
});
