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

  it("reports OrcaRouter router ids with the live catalog context windows", () => {
    expect(getCapabilitiesForModel("orcarouter", "orcarouter/fusion")).toMatchObject({
      reasoning: true,
      thinkingFormat: "openai",
      vision: true,
      contextWindow: 1000000,
      maxOutput: 128000,
    });
    expect(getCapabilitiesForModel("orcarouter", "orcarouter/fusion-flash").contextWindow).toBe(262144);
    // free pool rides the DeepSeek V4 Flash free line
    expect(getCapabilitiesForModel("orcarouter", "orcarouter/free")).toMatchObject({
      reasoning: true,
      vision: true,
      contextWindow: 1048576,
      maxOutput: 384000,
    });
    // raw `orca` alias resolves to the same table (no 200K-floor fallback)
    expect(getCapabilitiesForModel("orca", "orcarouter/free")).toMatchObject({
      reasoning: true,
      vision: true,
      contextWindow: 1048576,
    });
  });

  it("scopes OrcaRouter legacy DeepSeek alias limits to orcarouter only", () => {
    // On OrcaRouter these ids are 1M/384K V4-Flash aliases, unlike DeepSeek's own 128K API
    expect(getCapabilitiesForModel("orcarouter", "deepseek/deepseek-chat").contextWindow).toBe(1048576);
    expect(getCapabilitiesForModel("orcarouter", "deepseek/deepseek-reasoner")).toMatchObject({
      reasoning: true,
      thinkingFormat: "deepseek",
      contextWindow: 1048576,
    });
    // ...while the real DeepSeek provider keeps the stock 128K specs
    expect(getCapabilitiesForModel("deepseek", "deepseek-chat").contextWindow).toBe(128000);
  });

  it("gives the $0 free-pool ids their real catalog specs", () => {
    // glm-5.3-flash-free shares glm-5.3-flash's multimodal 1M-ctx spec per /v1/models +
    // /api/pricing — must not fall through to the 200K *glm-5.3* family pattern
    expect(getCapabilitiesForModel("orcarouter", "z-ai/glm-5.3-flash-free")).toMatchObject({
      reasoning: true,
      vision: true,
      contextWindow: 1000000,
      maxOutput: 128000,
    });
    // the other free-pool ids already resolve correctly through family patterns
    expect(getCapabilitiesForModel("orcarouter", "deepseek/deepseek-v4-flash-free").contextWindow).toBe(1000000);
    expect(getCapabilitiesForModel("orcarouter", "tencent/hy3-free").contextWindow).toBe(262144);
  });

  it("resolves prefixed vendor models through the canonical capability tables", () => {
    expect(getCapabilitiesForModel("orcarouter", "anthropic/claude-opus-4.8")).toMatchObject(claudeSonnet5Expected);
    expect(getCapabilitiesForModel("orcarouter", "google/gemini-3-flash-preview").thinkingFormat).toBe("gemini-level");
    expect(getCapabilitiesForModel("orcarouter", "z-ai/glm-5.1").thinkingFormat).toBe("zai");
    expect(getCapabilitiesForModel("orcarouter", "openai/gpt-image-1.5")).toMatchObject({
      imageOutput: true,
      tools: false,
    });
  });

  it("gives user-added custom models the pattern/floor fallback with vision heuristic", () => {
    // unknown custom id → safe floor (200K, no vision), tools on
    expect(getCapabilitiesForModel("orcarouter", "my-lab/my-custom-model")).toMatchObject({
      vision: false,
      reasoning: false,
      tools: true,
      contextWindow: 200000,
    });
    // claude-like / gpt-like custom ids still hit their family pattern
    expect(getCapabilitiesForModel("orcarouter", "proxy/claude-opus-9-custom").reasoning).toBe(true);
    expect(getCapabilitiesForModel("orcarouter", "tuning/gpt-5-custom-finetune").reasoning).toBe(true);
  });
});
