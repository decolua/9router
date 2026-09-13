import { describe, expect, it } from "vitest";
import { PROVIDER_MODELS } from "../../open-sse/config/providerModels.js";

describe("Kiro static provider models", () => {
  it("includes Claude Sonnet 5 and its synthetic Kiro variants", () => {
    const ids = (PROVIDER_MODELS.kr || []).map((model) => model.id);
    expect(ids).toEqual(expect.arrayContaining([
      "claude-sonnet-5",
      "claude-sonnet-5-thinking",
      "claude-sonnet-5-agentic",
      "claude-sonnet-5-thinking-agentic",
    ]));
  });

  it("includes GPT-5.6 family and synthetic Kiro variants", () => {
    const models = new Map((PROVIDER_MODELS.kr || []).map((model) => [model.id, model]));
    const ids = [...models.keys()];
    expect(ids).toEqual(expect.arrayContaining([
      "gpt-5.6-sol",
      "gpt-5.6-sol-thinking",
      "gpt-5.6-sol-agentic",
      "gpt-5.6-sol-thinking-agentic",
      "gpt-5.6-terra",
      "gpt-5.6-terra-thinking",
      "gpt-5.6-terra-agentic",
      "gpt-5.6-terra-thinking-agentic",
      "gpt-5.6-luna",
      "gpt-5.6-luna-thinking",
      "gpt-5.6-luna-agentic",
      "gpt-5.6-luna-thinking-agentic",
    ]));

    for (const [id, rateMultiplier] of [
      ["gpt-5.6-sol", 2.4],
      ["gpt-5.6-sol-thinking", 2.4],
      ["gpt-5.6-sol-agentic", 2.4],
      ["gpt-5.6-sol-thinking-agentic", 2.4],
      ["gpt-5.6-terra", 1.2],
      ["gpt-5.6-terra-thinking", 1.2],
      ["gpt-5.6-terra-agentic", 1.2],
      ["gpt-5.6-terra-thinking-agentic", 1.2],
      ["gpt-5.6-luna", 0.6],
      ["gpt-5.6-luna-thinking", 0.6],
      ["gpt-5.6-luna-agentic", 0.6],
      ["gpt-5.6-luna-thinking-agentic", 0.6],
    ]) {
      const model = models.get(id);
      const upstreamModelId = id.replace(/-(thinking-agentic|thinking|agentic)$/, "");
      expect(model).toMatchObject({
        contextLength: 272000,
        rateMultiplier,
        upstreamModelId,
      });
      expect(model.description).toContain("272k context window");
    }
  });
});
