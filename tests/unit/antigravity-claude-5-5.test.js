import { describe, expect, it } from "vitest";
import { createRequire } from "module";
import { getModelsByProviderId, getModelUpstreamId } from "../../open-sse/config/providerModels.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { applyThinking, stripThinkingSuffix } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { MITM_TOOLS } from "../../src/shared/constants/cliTools.js";

const require = createRequire(import.meta.url);
const { MODEL_SYNONYMS, MODEL_PATTERNS } = require("../../src/mitm/config.js");

describe("Antigravity Claude 5.5 models (#4555, #4548, #5785)", () => {
  it("includes Claude 5.5 models (including -max) in Antigravity provider registry with medium default", () => {
    const agModels = getModelsByProviderId("ag");
    const ids = agModels.map((m) => m.id);

    expect(ids).toContain("claude-sonnet-5-5-max");
    expect(ids).toContain("claude-sonnet-5-5-high");
    expect(ids).toContain("claude-sonnet-5-5-medium");
    expect(ids).toContain("claude-sonnet-5-5-low");
    expect(ids).toContain("claude-sonnet-5-5");
    expect(ids).not.toContain("claude-sonnet-5-5-thinking");
    expect(ids).not.toContain("claude-opus-5-5-thinking");
    expect(ids).toContain("claude-opus-5-5-max");
    expect(ids).toContain("claude-opus-5-5-high");
    expect(ids).toContain("claude-opus-5-5-medium");
    expect(ids).toContain("claude-opus-5-5-low");
    expect(ids).toContain("claude-opus-5-5");

    const sonnet = agModels.find((m) => m.id === "claude-sonnet-5-5");
    expect(sonnet?.upstreamModelId).toBe("claude-sonnet-5-5-medium(medium)");
    const opus = agModels.find((m) => m.id === "claude-opus-5-5");
    expect(opus?.upstreamModelId).toBe("claude-opus-5-5-medium(medium)");
  });

  it("resolves upstream model ID and effort tiers (including max) for Google Cloud Code API", () => {
    const upstreamSonnet = getModelUpstreamId("ag", "claude-sonnet-5-5");
    expect(upstreamSonnet).toBe("claude-sonnet-5-5-medium(medium)");
    expect(stripThinkingSuffix(upstreamSonnet)).toBe("claude-sonnet-5-5-medium");

    const upstreamOpus = getModelUpstreamId("ag", "claude-opus-5-5");
    expect(upstreamOpus).toBe("claude-opus-5-5-medium(medium)");
    expect(stripThinkingSuffix(upstreamOpus)).toBe("claude-opus-5-5-medium");

    const upstreamHigh = getModelUpstreamId("ag", "claude-sonnet-5-5-high");
    expect(upstreamHigh).toBe("claude-sonnet-5-5-high(high)");
    expect(stripThinkingSuffix(upstreamHigh)).toBe("claude-sonnet-5-5-high");

    const upstreamMax = getModelUpstreamId("ag", "claude-sonnet-5-5", { output_config: { effort: "max" } });
    expect(upstreamMax).toBe("claude-sonnet-5-5-max(max)");
    expect(stripThinkingSuffix(upstreamMax)).toBe("claude-sonnet-5-5-max");

    const upstreamOpusMax = getModelUpstreamId("ag", "claude-opus-5-5-max");
    expect(upstreamOpusMax).toBe("claude-opus-5-5-max(max)");
    expect(stripThinkingSuffix(upstreamOpusMax)).toBe("claude-opus-5-5-max");
  });

  it("declares low/medium/high/max thinking levels for Antigravity Claude 5.5 on both antigravity and ag", () => {
    for (const provider of ["antigravity", "ag"]) {
      for (const model of ["claude-sonnet-5-5", "claude-sonnet-5-5-max", "claude-opus-5-5", "claude-opus-5-5-max"]) {
        expect(getThinkingLevels(provider, model)).toEqual(["low", "medium", "high", "max"]);
      }
    }
  });

  it.each([
    ["claude-sonnet-5-5", "claude-sonnet-5-5-medium", "medium"],
    ["claude-sonnet-5-5-low", "claude-sonnet-5-5-low", "low"],
    ["claude-sonnet-5-5-medium", "claude-sonnet-5-5-medium", "medium"],
    ["claude-sonnet-5-5-high", "claude-sonnet-5-5-high", "high"],
    ["claude-sonnet-5-5-max", "claude-sonnet-5-5-max", "max"],
    ["claude-opus-5-5", "claude-opus-5-5-medium", "medium"],
    ["claude-opus-5-5-max", "claude-opus-5-5-max", "max"],
  ])("emits Cloud Code thinkingConfig for %s that survives AntigravityExecutor.transformRequest", (modelId, expectedWireModel, expectedLevel) => {
    const upstreamModel = getModelUpstreamId("ag", modelId);
    const wireModel = stripThinkingSuffix(upstreamModel);
    expect(wireModel).toBe(expectedWireModel);

    const body = {
      model: wireModel,
      request: {
        contents: [{ role: "user", parts: [{ text: "hello" }] }],
        generationConfig: {},
      },
    };

    applyThinking("antigravity", upstreamModel, body, "antigravity");
    const finalBody = new AntigravityExecutor().transformRequest(
      wireModel,
      body,
      true,
      { projectId: "project", connectionId: "connection" }
    );

    expect(finalBody.model).toBe(expectedWireModel);
    expect(finalBody.request.generationConfig.thinkingConfig).toEqual({
      thinkingLevel: expectedLevel,
      includeThoughts: true,
    });
    expect(finalBody.thinking).toBeUndefined();
    expect(finalBody.output_config).toBeUndefined();
  });

  it("resolves capabilities for Claude 5.5 models (including -max)", () => {
    for (const id of ["claude-sonnet-5-5", "claude-sonnet-5-5-max", "claude-opus-5-5", "claude-opus-5-5-max"]) {
      const caps = getCapabilitiesForModel("ag", id);
      expect(caps.vision).toBe(true);
      expect(caps.reasoning).toBe(true);
      expect(caps.contextWindow).toBe(1000000);
      expect(caps.maxOutput).toBe(128000);
    }
  });

  it("resolves pricing for Claude 5.5 models (including -max)", () => {
    for (const id of ["claude-sonnet-5-5", "claude-sonnet-5-5-max"]) {
      expect(getPricingForModel("ag", id)).toMatchObject({
        input: 2.0,
        output: 10.0,
      });
    }
    for (const id of ["claude-opus-5-5", "claude-opus-5-5-max"]) {
      expect(getPricingForModel("ag", id)).toMatchObject({
        input: 4.0,
        output: 20.0,
        cached: 0.2,
        cache_creation: 5.0,
      });
    }
  });

  it("includes Claude 5.5 models in Antigravity MITM configuration", () => {
    const ag = MITM_TOOLS.antigravity;
    expect(ag.modelAliases).toContain("claude-sonnet-5-5");
    expect(ag.modelAliases).toContain("claude-opus-5-5");
    expect(ag.modelAliases).not.toContain("claude-opus-5-5-thinking");

    const sonnet = ag.defaultModels.find((m) => m.id === "claude-sonnet-5-5");
    expect(sonnet).toBeTruthy();
    expect(sonnet.alias).toBe("claude-sonnet-5-5");

    const opus = ag.defaultModels.find((m) => m.id === "claude-opus-5-5");
    expect(opus).toBeTruthy();
    expect(opus.alias).toBe("claude-opus-5-5");
  });

  it("normalizes dotted and dashed model names via MITM synonyms", () => {
    const synonyms = MODEL_SYNONYMS.antigravity;
    expect(synonyms["claude-sonnet-5.5"]).toBe("claude-sonnet-5-5");
    expect(synonyms["claude-opus-5.5"]).toBe("claude-opus-5-5");
    expect(synonyms["claude-opus-5.5-thinking"]).toBe("claude-opus-5-5");
    expect(synonyms["claude-opus-5-5"]).toBe("claude-opus-5-5");
  });

  it("matches Claude 5.5 via MITM patterns before 4.6 fallback", () => {
    const patterns = MODEL_PATTERNS.antigravity;

    const matchModel = (raw) => {
      for (const { match, alias } of patterns) {
        if (match.test(raw)) return alias;
      }
      return null;
    };

    expect(matchModel("claude-sonnet-5.5")).toBe("claude-sonnet-5-5");
    expect(matchModel("claude-sonnet-5-5")).toBe("claude-sonnet-5-5");
    expect(matchModel("claude-opus-5.5")).toBe("claude-opus-5-5");
    expect(matchModel("claude-opus-5-5-thinking")).toBe("claude-opus-5-5");

    // Legacy fallback still works
    expect(matchModel("claude-sonnet-4.6")).toBe("claude-sonnet-4-6");
    expect(matchModel("claude-opus-4.6")).toBe("claude-opus-4-6-thinking");
  });
});
