import { describe, expect, it } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

describe("getCapabilitiesForModel", () => {
  it("resolves NVIDIA MiniMax-M3 to OpenAI thinking format", () => {
    const caps = getCapabilitiesForModel("nvidia", "minimaxai/minimax-m3");
    expect(caps.reasoning).toBe(true);
    expect(caps.vision).toBe(true);
    expect(caps.thinkingFormat).toBe("openai");
    expect(caps.thinkingCanDisable).toBe(false);
    expect(caps.contextWindow).toBe(1048576);
  });

  it("resolves NVIDIA MiniMax-M2.7 to OpenAI thinking format", () => {
    const caps = getCapabilitiesForModel("nvidia", "minimaxai/minimax-m2.7");
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingFormat).toBe("openai");
  });

  it("resolves NVIDIA GLM 4.7 to OpenAI thinking format", () => {
    const caps = getCapabilitiesForModel("nvidia", "z-ai/glm4.7");
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingFormat).toBe("openai");
  });

  it("falls through to pattern capabilities for NVIDIA models without provider override", () => {
    const caps = getCapabilitiesForModel("nvidia", "deepseek-ai/deepseek-v4-pro");
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingFormat).toBe("deepseek");
  });

  it("reports Kiro Claude Opus 4.8 as a 1M context model", () => {
    expect(getCapabilitiesForModel("kiro", "claude-opus-4.8").contextWindow).toBe(1000000);
    expect(getCapabilitiesForModel("kiro", "anthropic/claude-opus-4.8").contextWindow).toBe(1000000);
    expect(getCapabilitiesForModel("kiro", "claude-opus-4-8").contextWindow).toBe(1000000);
    expect(getCapabilitiesForModel("kiro", "claude-opus-4.8-thinking").contextWindow).toBe(1000000);
    expect(getCapabilitiesForModel("kiro", "claude-opus-4-8-thinking").contextWindow).toBe(1000000);
  });
});
