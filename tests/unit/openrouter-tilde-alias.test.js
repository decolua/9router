import { describe, expect, it } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

describe("getCapabilitiesForModel — OpenRouter tilde 'latest' aliases (BUG: never un-aliased)", () => {
  it("or/~anthropic/claude-sonnet-latest should resolve to real claude-sonnet-5 spec", () => {
    const caps = getCapabilitiesForModel("openrouter", "~anthropic/claude-sonnet-latest");
    expect(caps).toMatchObject({
      contextWindow: 1000000,
      maxOutput: 128000,
      thinkingFormat: "claude-adaptive",
      reasoning: true,
      vision: true,
    });
  });

  it("or/~anthropic/claude-opus-latest should resolve to real claude-opus-5 spec", () => {
    const caps = getCapabilitiesForModel("openrouter", "~anthropic/claude-opus-latest");
    expect(caps).toMatchObject({
      contextWindow: 1000000,
      maxOutput: 128000,
      thinkingFormat: "claude-adaptive",
      reasoning: true,
      vision: true,
    });
  });

  it("or/~openai/gpt-sol-latest should resolve with reasoning enabled", () => {
    const caps = getCapabilitiesForModel("openrouter", "~openai/gpt-sol-latest");
    // gpt-5.6-sol resolves via pattern *gpt-5*, which has reasoning:true, thinkingFormat:openai, vision:true, contextWindow:400k/maxOutput:128k
    expect(caps).toMatchObject({
      reasoning: true,
      thinkingFormat: "openai",
      vision: true,
    });
  });
});
