import { describe, expect, it } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { translateRequest } from "../../open-sse/translator/index.js";

describe("getCapabilitiesForModel", () => {
  const claudeSonnet5Expected = {
    contextWindow: 1000000,
    maxOutput: 128000,
    thinkingFormat: "claude-adaptive",
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

  it("uses OpenAI thinking format for NVIDIA-hosted reasoning model families", () => {
    for (const model of [
      "z-ai/glm-5.2",
      "deepseek-ai/deepseek-v4-pro",
      "deepseek-ai/deepseek-v4-flash",
      "moonshotai/kimi-k2.6",
      "nvidia/nemotron-3-nano-30b-a3b",
      "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
      "nvidia/nemotron-3-ultra-550b-a55b",
      "qwen/qwen3-next-80b-a3b-instruct",
      "qwen/qwen3.5-122b-a10b",
      "stepfun-ai/step-3.7-flash",
    ]) {
      expect(getCapabilitiesForModel("nvidia", model)).toMatchObject({
        reasoning: true,
        thinkingFormat: "openai",
      });
    }
  });

  it("translates NVIDIA reasoning intent to reasoning_effort instead of vendor-native thinking fields", () => {
    const out = translateRequest(
      "openai",
      "openai",
      "qwen/qwen3-next-80b-a3b-instruct",
      {
        messages: [{ role: "user", content: "hi" }],
        stream: false,
        reasoning_effort: "high",
      },
      false,
      null,
      "nvidia",
    );

    expect(out.reasoning_effort).toBe("high");
    expect(out.enable_thinking).toBeUndefined();
    expect(out.thinking).toBeUndefined();
    expect(out.thinking_budget).toBeUndefined();
  });
});
