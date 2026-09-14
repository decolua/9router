import { describe, expect, it } from "vitest";
import { withChatGPTReasoning } from "../../src/lib/chatgpt/reasoning.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

describe("ChatGPT reasoning across provider routes", () => {
  it.each(["glm/glm-5.3", "glm/glm-5.3-flash", "cmc/zai-org/GLM-5.3"])("exposes real GLM effort levels for %s", async id => {
    const [model] = await withChatGPTReasoning([{ id }]);
    expect(model.reasoningLevels).toEqual(["low", "high", "max"]);
    expect(model.defaultReasoningLevel).toBe("high");
  });
  it("uses the intersection of nested Combo members and resolves aliases", async () => {
    const combos = [{ name: "Nested", models: ["zai", { model: "openrouter/z-ai/glm-5.3" }] }, { name: "Mixed", models: ["Nested", { id: "ds/deepseek-flash" }] }];
    const result = await withChatGPTReasoning([{ id: "Mixed" }], combos, { zai: "glm/glm-5.3" });
    expect(result[0].reasoningLevels).toEqual(["high", "max"]);
  });
  it("keeps Gemini levels common across direct and fallback routes", async () => {
    const [model] = await withChatGPTReasoning([{ id: "Gemini" }], [{ name: "Gemini", models: ["gemini/gemini-3.8-flash", "ag/gemini-3.8-flash", "openrouter/google/gemini-3.8-flash"] }]);
    expect(model.reasoningLevels).toEqual(["minimal", "low", "medium", "high"]);
  });
  it.each([
    [{ name: "A", models: ["B"] }, { name: "B", models: ["A"] }],
    [{ name: "A", models: [] }], [{ name: "A", models: ["glm/glm-5.3", "openai/gpt-4o"] }],
    [{ name: "A", models: ["glm/glm-5.3(max)"] }],
  ])("hides unusable choices for cyclic, empty, mixed or fixed Combos", async (...combos) => {
    const [model] = await withChatGPTReasoning([{ id: "A" }], combos);
    expect(model.reasoningLevels).toEqual([]);
    expect(model.defaultReasoningLevel).toBeNull();
  });
  it("maps on/off reasoning to valid Codex enum values", async () => {
    const [model] = await withChatGPTReasoning([{ id: "glm/glm-5" }]);
    expect(model.reasoningLevels).toEqual(["none", "high"]);
  });
  it.each(["low", "high", "max"])("carries GLM %s to the actual provider thinking normalization", level => {
    expect(getThinkingLevels("glm", "glm-5.3")).toContain(level);
    expect(getCapabilitiesForModel("glm", "glm-5.3").thinkingCanDisable).toBe(false);
    const body = { reasoning: { effort: level } };
    applyThinking("openai", "glm-5.3", body, "glm");
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.reasoning_effort).toBe(level);
  });
});
