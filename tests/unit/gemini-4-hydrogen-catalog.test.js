import { describe, expect, it } from "vitest";

import { getModelUpstreamId, getModelsByProviderId } from "../../open-sse/config/providerModels.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";

const HYDROGEN_MODELS = [
  ["gemini-4-hydrogen-xhigh", "gemini-4-hydrogen-xhigh(xhigh)"],
  ["gemini-4-hydrogen-high", "gemini-4-hydrogen-high(high)"],
  ["gemini-4-hydrogen-medium", "gemini-4-hydrogen-medium(medium)"],
  ["gemini-4-hydrogen-low", "gemini-4-hydrogen-low(low)"],
  ["gemini-4-hydrogen", "gemini-4-hydrogen-high(high)"],
];

describe("Gemini 4 Hydrogen Antigravity catalog", () => {
  it("registers each thinking tier with its upstream model mapping", () => {
    const models = getModelsByProviderId("antigravity");
    const modelIds = new Set(models.map((model) => model.id));

    for (const [modelId, upstreamModelId] of HYDROGEN_MODELS) {
      expect(modelIds.has(modelId)).toBe(true);
      expect(getModelUpstreamId("ag", modelId)).toBe(upstreamModelId);
    }
  });

  it("exposes Hydrogen capabilities, thinking levels and pricing", () => {
    expect(getCapabilitiesForModel("antigravity", "gemini-4-hydrogen")).toMatchObject({
      pdf: true,
      reasoning: true,
      thinkingFormat: "gemini-level",
      thinkingCanDisable: false,
      contextWindow: 1048576,
      maxOutput: 65536,
      longDecode: true,
    });
    expect(getThinkingLevels("antigravity", "gemini-4-hydrogen")).toEqual(["low", "medium", "high", "xhigh"]);
    expect(getPricingForModel("antigravity", "gemini-4-hydrogen")).toEqual({
      input: 1.5,
      output: 7.5,
      cached: 0.075,
      reasoning: 7.5,
      cache_creation: 1.5,
    });
  });
});
