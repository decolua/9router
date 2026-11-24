import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveKiroModels, clearKiroModelCache } from "../../open-sse/services/kiroModels.js";
import provider from "../../open-sse/providers/registry/kiro.js";
import { openaiToKiroRequest } from "../../open-sse/translator/request/openai-to-kiro.js";
afterEach(() => {
  vi.unstubAllGlobals();
  clearKiroModelCache();
});
describe("canonical Kiro catalog", () => {
  it("advertises one live row per model while retaining upstream metadata", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      models: [{
        modelId: "claude-sonnet-5",
        modelName: "Sonnet",
        rateMultiplier: 1.2,
        tokenLimits: {
          maxInputTokens: 1000000
        }
      }, {
        modelId: "auto",
        modelName: "Auto"
      }]
    })));
    const result = await resolveKiroModels({
      accessToken: "fixture"
    }, {
      forceRefresh: true
    });
    expect(result.models.map(m => m.id)).toEqual(["claude-sonnet-5", "auto"]);
    expect(result.models[0]).toMatchObject({
      contextLength: 1000000,
      rateMultiplier: 1.2,
      upstreamModelId: "claude-sonnet-5"
    });
  });
  it("keeps current model families and removes only synthetic catalog aliases", () => {
    const ids = provider.models.map(m => m.id);
    expect(ids).toEqual(expect.arrayContaining(["auto", "claude-opus-5.5", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]));
    expect(ids.some(id => /-(thinking(?:-agentic)?|agentic)$/.test(id))).toBe(false);
  });
  it.each(["claude-sonnet-5-thinking", "claude-sonnet-5-agentic", "claude-sonnet-5-thinking-agentic"])("keeps legacy requests routable: %s", model => {
    const request = openaiToKiroRequest(model, {
      messages: [{
        role: "user",
        content: "hello"
      }]
    }, true, {});
    expect(request.conversationState.currentMessage.userInputMessage.modelId).toBe("claude-sonnet-5");
  });
});
