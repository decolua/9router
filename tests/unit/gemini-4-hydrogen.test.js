import { describe, expect, it } from "vitest";

import { getModelsByProviderId, getModelUpstreamId, isValidModel } from "../../open-sse/config/providerModels.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { getCapabilitiesForModel, isGemini4Model } from "../../open-sse/providers/capabilities.js";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { applyThinking, stripThinkingSuffix } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { getAntigravityModelFamily, getAntigravityModelQuota } from "../../src/sse/services/antigravityQuota.js";

describe("Gemini 4 Hydrogen Antigravity registry & capabilities", () => {
  it("registers tiered variants and bare alias in antigravity registry", () => {
    const ids = getModelsByProviderId("antigravity").map((m) => m.id);
    expect(ids).toContain("gemini-4-hydrogen-high");
    expect(ids).toContain("gemini-4-hydrogen-medium");
    expect(ids).toContain("gemini-4-hydrogen-low");
    expect(ids).toContain("gemini-4-hydrogen");
    expect(isValidModel("ag", "gemini-4-hydrogen")).toBe(true);
    expect(isValidModel("ag", "gemini-4-hydrogen-high")).toBe(true);
  });

  it("declares Gemini 4 capabilities and thinking levels", () => {
    for (const model of [
      "gemini-4-hydrogen",
      "gemini-4-hydrogen-high",
      "gemini-4-hydrogen-medium",
      "gemini-4-hydrogen-low",
    ]) {
      const caps = getCapabilitiesForModel("antigravity", model);
      expect(caps.vision).toBe(true);
      expect(caps.audioInput).toBe(true);
      expect(caps.videoInput).toBe(true);
      expect(caps.reasoning).toBe(true);
      expect(caps.search).toBe(true);
      expect(caps.thinkingFormat).toBe("gemini-level");
      expect(caps.thinkingCanDisable).toBe(false);
      expect(caps.contextWindow).toBe(1048576);
      expect(caps.maxOutput).toBe(65536);
      expect(getThinkingLevels("antigravity", model)).toEqual(["low", "medium", "high"]);
      expect(isGemini4Model(model)).toBe(true);
    }
  });

  it("prices gemini-4-hydrogen using the gemini-4 pattern", () => {
    const expected = { input: 2, output: 10, cached: 0.1, reasoning: 10, cache_creation: 0.1875 };
    expect(getPricingForModel("antigravity", "gemini-4-hydrogen")).toEqual(expected);
    expect(getPricingForModel("antigravity", "gemini-4-hydrogen-high")).toEqual(expected);
    expect(getPricingForModel("antigravity", "gemini-4-hydrogen-medium")).toEqual(expected);
    expect(getPricingForModel("antigravity", "gemini-4-hydrogen-low")).toEqual(expected);
  });
});

describe("Gemini 4 Hydrogen Antigravity tier mapping", () => {
  it.each([
    ["gemini-4-hydrogen-high", "high"],
    ["gemini-4-hydrogen-medium", "medium"],
    ["gemini-4-hydrogen-low", "low"],
  ])("maps %s to the wire model with a %s thinking level", (modelId, expectedLevel) => {
    const upstreamModel = getModelUpstreamId("ag", modelId);
    expect(upstreamModel).toBe(`${modelId}(${expectedLevel})`);

    const body = {
      model: stripThinkingSuffix(upstreamModel),
      request: {
        contents: [{ role: "user", parts: [{ text: "hello" }] }],
        generationConfig: {},
      },
    };

    applyThinking("antigravity", upstreamModel, body, "antigravity");
    const finalBody = new AntigravityExecutor().transformRequest(
      modelId,
      body,
      true,
      { projectId: "project", connectionId: "connection" }
    );

    expect(finalBody.model).toBe(modelId);
    expect(finalBody.request.generationConfig.thinkingConfig).toEqual({
      thinkingLevel: expectedLevel,
      includeThoughts: true,
    });
  });

  it("resolves bare gemini-4-hydrogen to medium by default and adapts to reasoning_effort", () => {
    expect(getModelUpstreamId("ag", "gemini-4-hydrogen", {})).toBe("gemini-4-hydrogen-medium(medium)");
    expect(getModelUpstreamId("ag", "gemini-4-hydrogen", { reasoning_effort: "high" })).toBe("gemini-4-hydrogen-high(high)");
    expect(getModelUpstreamId("ag", "gemini-4-hydrogen", { reasoning_effort: "low" })).toBe("gemini-4-hydrogen-low(low)");
  });
});

describe("Gemini 4 Hydrogen Antigravity quota resolution", () => {
  it("maps gemini-4-hydrogen to the shared gemini quota family and resolves medium alias", () => {
    expect(getAntigravityModelFamily("gemini-4-hydrogen")).toBe("gemini");
    expect(getAntigravityModelFamily("gemini-4-hydrogen-high")).toBe("gemini");

    const quotas = {
      "gemini-4-hydrogen-medium": { remainingPercentage: 80, resetAt: "2026-11-15T00:00:00Z" },
      gemini_session: { remainingPercentage: 90, resetAt: "2026-11-14T12:00:00Z" },
    };
    expect(getAntigravityModelQuota(quotas, "gemini-4-hydrogen")).toEqual({
      remainingPercentage: 80,
      resetAt: "2026-11-15T00:00:00Z",
    });
  });
});
