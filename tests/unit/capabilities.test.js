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

  // Opus 5 shipped after the 4.8 patterns were written and fell through to the generic
  // "*claude*opus*" entry, so every thinking request 400'd on the budget shape and
  // max_tokens was clamped to the 64k floor.
  it("reports Claude Opus 5 as a 1M adaptive-thinking model", () => {
    for (const model of [
      "claude-opus-5", "anthropic/claude-opus-5", "claude-opus-5-thinking",
      "claude-opus-5-agentic", "claude-opus-5-20260724",
    ]) {
      expect(getCapabilitiesForModel("github", model)).toMatchObject(claudeSonnet5Expected);
    }
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

// maxOutput is a clamp ceiling (translator/formats/claude.js, openai-to-claude.js), and
// contextWindow drives context accounting — a variant that drops to the 200k/64k floor
// is silently capped at half its real output budget. Limits verified upstream:
// "max_tokens: 999999 > 128000" / "prompt is too long: ... > 1000000 maximum".
describe("4.6+ Claude limits reach unlisted variants", () => {
  const family = { contextWindow: 1000000, maxOutput: 128000, thinkingFormat: "claude-adaptive" };

  it("gives claude-opus-4.8-fast the same limits as claude-opus-4.8", () => {
    expect(getCapabilitiesForModel("github", "claude-opus-4.8-fast")).toMatchObject(family);
    expect(getCapabilitiesForModel("github", "claude-opus-4.8")).toMatchObject(family);
  });

  it("covers variants of every 4.6+ family", () => {
    for (const model of [
      "claude-sonnet-5.1", "claude-sonnet-4.6-preview", "claude-opus-4.7-fast",
      "anthropic/claude-opus-4.6", "claude-fable-5-preview", "claude-opus-5-fast",
    ]) {
      expect(getCapabilitiesForModel("github", model)).toMatchObject(family);
    }
  });

  it("leaves 4.5 and older on the conservative floor", () => {
    for (const model of ["claude-haiku-4.5", "claude-sonnet-4.5", "claude-opus-4.5"]) {
      const caps = getCapabilitiesForModel("github", model);
      expect(caps.contextWindow).toBe(200000);
      expect(caps.maxOutput).toBe(64000);
    }
  });

  it("does not let the shared caps object leak mutations between lookups", () => {
    const first = getCapabilitiesForModel("github", "claude-opus-4.8-fast");
    first.maxOutput = 1;
    expect(getCapabilitiesForModel("github", "claude-opus-4.8").maxOutput).toBe(128000);
  });
});
