import { describe, expect, it } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";

describe("Muse Spark 1.3 exact capabilities", () => {
  const MUSE_13_FREE = "muse-spark-1.3-contributor-free";
  const MUSE_13_GO = "muse-spark-1.3-contributor";
  const EXACT_13 = {
    reasoning: true,
    thinkingFormat: "openai",
    thinkingCanDisable: false,
    contextWindow: 1048576,
    maxOutput: 131072,
    vision: false,
    pdf: false,
    audioInput: false,
    videoInput: false,
    imageOutput: false,
    audioOutput: false,
    search: false,
  };

  it("declares exact 1.3 limits for the OpenCode Free (Zen) id without modalities", () => {
    expect(getCapabilitiesForModel("opencode", MUSE_13_FREE)).toMatchObject(EXACT_13);
  });

  it("declares the same exact 1.3 capabilities for the OpenCode Go id", () => {
    expect(getCapabilitiesForModel("opencode-go", MUSE_13_GO)).toMatchObject(EXACT_13);
  });

  it("keeps the retained 1.2 free id at its existing exact capabilities", () => {
    expect(getCapabilitiesForModel("opencode", "muse-spark-1.2-contributor-free")).toMatchObject({
      reasoning: true,
      thinkingFormat: "openai",
      thinkingCanDisable: true,
      contextWindow: 1048576,
      maxOutput: 131072,
    });
  });

  it("omits none from 1.3 thinking levels (minimal..xhigh only)", () => {
    expect(getThinkingLevels("opencode", MUSE_13_FREE)).toEqual(["minimal", "low", "medium", "high", "xhigh"]);
    expect(getThinkingLevels("opencode-go", MUSE_13_GO)).toEqual(["minimal", "low", "medium", "high", "xhigh"]);
  });
});

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
});
