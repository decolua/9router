import { describe, expect, it } from "vitest";
import { createRequire } from "module";
import { getModelsByProviderId, getModelUpstreamId } from "../../open-sse/config/providerModels.js";
import { stripThinkingSuffix } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";
import { MITM_TOOLS } from "../../src/shared/constants/cliTools.js";

const require = createRequire(import.meta.url);
const { MODEL_SYNONYMS, MODEL_PATTERNS } = require("../../src/mitm/config.js");

describe("Antigravity Claude 5.5 models (#4555, #4548)", () => {
  it("includes Claude 5.5 models in Antigravity provider registry", () => {
    const agModels = getModelsByProviderId("ag");
    const ids = agModels.map((m) => m.id);

    expect(ids).toContain("claude-sonnet-5-5-high");
    expect(ids).toContain("claude-sonnet-5-5-medium");
    expect(ids).toContain("claude-sonnet-5-5-low");
    expect(ids).toContain("claude-sonnet-5-5");
    expect(ids).not.toContain("claude-sonnet-5-5-thinking");
    expect(ids).not.toContain("claude-opus-5-5-thinking");
    expect(ids).toContain("claude-opus-5-5-high");
    expect(ids).toContain("claude-opus-5-5-medium");
    expect(ids).toContain("claude-opus-5-5-low");
    expect(ids).toContain("claude-opus-5-5");

    const sonnet = agModels.find((m) => m.id === "claude-sonnet-5-5");
    expect(sonnet?.upstreamModelId).toBe("claude-sonnet-5-5-high(high)");
    const opus = agModels.find((m) => m.id === "claude-opus-5-5");
    expect(opus?.upstreamModelId).toBe("claude-opus-5-5-high(high)");
  });

  it("resolves upstream model ID with thinking stripped for Google Cloud Code API", () => {
    const upstreamSonnet = getModelUpstreamId("ag", "claude-sonnet-5-5");
    expect(upstreamSonnet).toBe("claude-sonnet-5-5-high(high)");
    expect(stripThinkingSuffix(upstreamSonnet)).toBe("claude-sonnet-5-5-high");

    const upstreamOpus = getModelUpstreamId("ag", "claude-opus-5-5");
    expect(upstreamOpus).toBe("claude-opus-5-5-high(high)");
    expect(stripThinkingSuffix(upstreamOpus)).toBe("claude-opus-5-5-high");

    const upstreamHigh = getModelUpstreamId("ag", "claude-sonnet-5-5-high");
    expect(upstreamHigh).toBe("claude-sonnet-5-5-high(high)");
    expect(stripThinkingSuffix(upstreamHigh)).toBe("claude-sonnet-5-5-high");
  });

  it("resolves capabilities for Claude 5.5 models", () => {
    for (const id of ["claude-sonnet-5-5", "claude-opus-5-5"]) {
      const caps = getCapabilitiesForModel("ag", id);
      expect(caps.vision).toBe(true);
      expect(caps.reasoning).toBe(true);
      expect(caps.contextWindow).toBe(1000000);
      expect(caps.maxOutput).toBe(128000);
    }
  });

  it("resolves pricing for Claude 5.5 models", () => {
    expect(getPricingForModel("ag", "claude-sonnet-5-5")).toMatchObject({
      input: 2.0,
      output: 10.0,
    });
    expect(getPricingForModel("ag", "claude-opus-5-5")).toMatchObject({
      input: 4.0,
      output: 20.0,
      cached: 0.2,
      cache_creation: 5.0,
    });
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
