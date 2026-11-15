import { describe, expect, it } from "vitest";
import { createRequire } from "module";

import { getModelUpstreamId, getModelsByProviderId } from "../../open-sse/config/providerModels.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { getCapabilitiesForModel, isGemini4Model } from "../../open-sse/providers/capabilities.js";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { applyThinking, stripThinkingSuffix } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { MITM_TOOLS } from "../../src/shared/constants/cliTools.js";

const require = createRequire(import.meta.url);
const { MODEL_PATTERNS } = require("../../src/mitm/config.js");

// Antigravity tier ids as served by v1internal:fetchAvailableModels.
const AG_TIERS = [
  ["gemini-4-hydrogen-xhigh", "xhigh"],
  ["gemini-4-hydrogen-high", "high"],
  ["gemini-4-hydrogen-medium", "medium"],
  ["gemini-4-hydrogen-low", "low"],
];

describe("Gemini 4 Hydrogen registry", () => {
  it("is listed on the Gemini API provider", () => {
    const ids = getModelsByProviderId("gemini").map((m) => m.id);
    expect(ids).toContain("gemini-4-hydrogen");
  });

  it("registers every Antigravity tier plus a bare alias on Hydrogen's default (high)", () => {
    const models = getModelsByProviderId("antigravity");
    for (const [id, level] of AG_TIERS) {
      expect(models.find((m) => m.id === id)?.upstreamModelId).toBe(`${id}(${level})`);
    }
    expect(models.find((m) => m.id === "gemini-4-hydrogen")?.upstreamModelId).toBe("gemini-4-hydrogen-high(high)");
  });

  it("is treated as a Gemini 4 model (sampling params dropped, functionResponse-last)", () => {
    expect(isGemini4Model("gemini-4-hydrogen")).toBe(true);
    expect(isGemini4Model("gemini-4-hydrogen-xhigh")).toBe(true);
  });
});

describe("Gemini 4 Hydrogen capabilities", () => {
  it.each([
    ["gemini", "gemini-4-hydrogen"],
    ["antigravity", "gemini-4-hydrogen"],
    ...AG_TIERS.map(([id]) => ["antigravity", id]),
  ])("declares multimodal always-on level reasoning on %s/%s", (provider, model) => {
    const caps = getCapabilitiesForModel(provider, model);
    expect(caps).toMatchObject({
      vision: true,
      pdf: true,
      audioInput: true,
      videoInput: true,
      reasoning: true,
      search: true,
      thinkingFormat: "gemini-level",
      thinkingCanDisable: false,
      contextWindow: 1048576,
      maxOutput: 65536,
      minOutputTokens: 32768,
    });
    expect(getThinkingLevels(provider, model)).toEqual(["low", "medium", "high", "xhigh"]);
  });

  it("leaves Gemini 4 Argon on its three-level set", () => {
    expect(getThinkingLevels("gemini", "gemini-4-argon")).toEqual(["low", "medium", "high"]);
    expect(getCapabilitiesForModel("gemini", "gemini-4-argon").minOutputTokens).toBeNull();
  });
});

describe("Gemini 4 Hydrogen thinking on the Gemini API wire", () => {
  const level = (intent) => {
    const body = { ...intent };
    applyThinking("gemini", "gemini-4-hydrogen", body, "gemini");
    return body.generationConfig.thinkingConfig;
  };

  it.each(["xhigh", "max", "ultra"])("sends XHIGH for reasoning_effort %s", (effort) => {
    expect(level({ reasoning_effort: effort })).toEqual({ thinkingLevel: "xhigh", includeThoughts: true });
  });

  it("passes low/medium/high through", () => {
    for (const effort of ["low", "medium", "high"]) {
      expect(level({ reasoning_effort: effort }).thinkingLevel).toBe(effort);
    }
  });

  it("floors none/minimal at low (no MINIMAL tier, thinking cannot be disabled)", () => {
    expect(level({ reasoning_effort: "none" })).toEqual({ thinkingLevel: "low", includeThoughts: true });
    expect(level({ reasoning_effort: "minimal" }).thinkingLevel).toBe("low");
  });

  it("maps Claude-style budgets onto the level scale, including XHIGH", () => {
    expect(level({ thinking: { type: "enabled", budget_tokens: 32768 } }).thinkingLevel).toBe("xhigh");
    expect(level({ thinking: { type: "enabled", budget_tokens: 24576 } }).thinkingLevel).toBe("high");
    expect(level({ thinking: { type: "enabled", budget_tokens: 512 } }).thinkingLevel).toBe("low");
  });

  it("honors a (xhigh) model suffix", () => {
    const body = {};
    applyThinking("gemini", "gemini-4-hydrogen(xhigh)", body, "gemini");
    expect(body.generationConfig.thinkingConfig.thinkingLevel).toBe("xhigh");
  });

  it("still clamps xhigh to high for Gemini 4 Argon (regression guard)", () => {
    const body = { reasoning_effort: "xhigh" };
    applyThinking("gemini", "gemini-4-argon", body, "gemini");
    expect(body.generationConfig.thinkingConfig.thinkingLevel).toBe("high");
  });

  it("maps ultra to high (not the lowest tier) on models without XHIGH", () => {
    const body = { reasoning_effort: "ultra" };
    applyThinking("gemini", "gemini-3-flash-preview", body, "gemini");
    expect(body.generationConfig.thinkingConfig.thinkingLevel).toBe("high");
  });
});

describe("Gemini 4 Hydrogen 32K max output floor", () => {
  it("raises a small limit to 32768 even at low effort", () => {
    const body = { reasoning_effort: "low", generationConfig: { maxOutputTokens: 1000 } };
    applyThinking("gemini", "gemini-4-hydrogen", body, "gemini");
    expect(body.generationConfig.maxOutputTokens).toBe(32768);
  });

  it("keeps the larger high/xhigh floor", () => {
    const body = { reasoning_effort: "xhigh", generationConfig: { maxOutputTokens: 1000 } };
    applyThinking("gemini", "gemini-4-hydrogen", body, "gemini");
    expect(body.generationConfig.maxOutputTokens).toBe(65535);
  });

  it("raises a small limit when the client sends no thinking intent", () => {
    const body = { generationConfig: { maxOutputTokens: 4096 } };
    applyThinking("gemini", "gemini-4-hydrogen", body, "gemini");
    expect(body.generationConfig).toEqual({ maxOutputTokens: 32768 });
  });

  it("raises it inside the Antigravity request envelope", () => {
    const body = { request: { generationConfig: { maxOutputTokens: 2048 } } };
    applyThinking("antigravity", "gemini-4-hydrogen-high", body, "antigravity");
    expect(body.request.generationConfig.maxOutputTokens).toBe(32768);
  });

  it("leaves an unset limit and larger limits alone", () => {
    const unset = { generationConfig: {} };
    applyThinking("gemini", "gemini-4-hydrogen", unset, "gemini");
    expect(unset.generationConfig).toEqual({});

    const large = { generationConfig: { maxOutputTokens: 50000 } };
    applyThinking("gemini", "gemini-4-hydrogen", large, "gemini");
    expect(large.generationConfig.maxOutputTokens).toBe(50000);
  });

  it("does not touch other Gemini models or OpenAI-wire Hydrogen", () => {
    const argon = { generationConfig: { maxOutputTokens: 1000 } };
    applyThinking("gemini", "gemini-4-argon", argon, "gemini");
    expect(argon.generationConfig.maxOutputTokens).toBe(1000);

    const openaiWire = { max_tokens: 1000 };
    applyThinking("openai", "gemini-4-hydrogen", openaiWire, "github");
    expect(openaiWire).toEqual({ max_tokens: 1000 });
  });
});

describe("Gemini 4 Hydrogen OpenAI → Gemini translation", () => {
  it("drops sampling params and sends XHIGH with a safe output budget", () => {
    const out = translateRequest("openai", "gemini", "gemini-4-hydrogen", {
      model: "gemini-4-hydrogen",
      messages: [{ role: "user", content: "hi" }],
      temperature: 0.2,
      top_p: 0.9,
      max_tokens: 512,
      reasoning_effort: "xhigh",
    }, false, null, "gemini");

    const gc = out.generationConfig;
    expect(gc.temperature).toBeUndefined();
    expect(gc.topP).toBeUndefined();
    expect(gc.thinkingConfig).toEqual({ thinkingLevel: "xhigh", includeThoughts: true });
    expect(gc.maxOutputTokens).toBe(65535);
  });
});

describe("Gemini 4 Hydrogen Antigravity tier routing", () => {
  it("resolves the bare id to the high tier", () => {
    expect(getModelUpstreamId("ag", "gemini-4-hydrogen")).toBe("gemini-4-hydrogen-high(high)");
  });

  it("routes xhigh / max intents to the XHigh tier model", () => {
    expect(getModelUpstreamId("ag", "gemini-4-hydrogen(xhigh)")).toBe("gemini-4-hydrogen-xhigh(xhigh)");
    expect(getModelUpstreamId("ag", "gemini-4-hydrogen", { reasoning_effort: "xhigh" })).toBe("gemini-4-hydrogen-xhigh(xhigh)");
    expect(getModelUpstreamId("ag", "gemini-4-hydrogen", { reasoning_effort: "max" })).toBe("gemini-4-hydrogen-xhigh(xhigh)");
    expect(getModelUpstreamId("ag", "gemini-4-hydrogen", { thinking: { type: "enabled", budget_tokens: 32768 } })).toBe("gemini-4-hydrogen-xhigh(xhigh)");
  });

  it("routes lower intents to their tiers", () => {
    expect(getModelUpstreamId("ag", "gemini-4-hydrogen", { reasoning_effort: "medium" })).toBe("gemini-4-hydrogen-medium(medium)");
    expect(getModelUpstreamId("ag", "gemini-4-hydrogen", { reasoning_effort: "minimal" })).toBe("gemini-4-hydrogen-low(low)");
  });

  it("keeps xhigh on the -high tier for families without an XHigh tier", () => {
    expect(getModelUpstreamId("ag", "gemini-4-carbon", { reasoning_effort: "xhigh" })).toBe("gemini-4-carbon-high(high)");
    expect(getModelUpstreamId("ag", "gemini-3.8-flash", { reasoning_effort: "max" })).toBe("gemini-3.8-flash-high(high)");
  });

  it.each(AG_TIERS)("sends %s on the wire with a %s thinking level", (modelId, expectedLevel) => {
    const upstreamModel = getModelUpstreamId("ag", modelId);
    const body = {
      model: stripThinkingSuffix(upstreamModel),
      request: {
        contents: [{ role: "user", parts: [{ text: "hello" }] }],
        generationConfig: { temperature: 0.3 },
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
    expect(finalBody.request.generationConfig.thinkingConfig).toEqual({ thinkingLevel: expectedLevel, includeThoughts: true });
  });
});

describe("Gemini 4 Hydrogen pricing", () => {
  it.each([
    ["gemini", "gemini-4-hydrogen"],
    ["antigravity", "gemini-4-hydrogen-xhigh"],
    ["antigravity", "gemini-4-hydrogen-low"],
  ])("bills %s/%s at $1.50 / $7.50", (provider, model) => {
    expect(getPricingForModel(provider, model)).toMatchObject({
      input: 1.5,
      output: 7.5,
      cached: 0.075,
      reasoning: 7.5,
    });
  });

  it("leaves the other Gemini 4 models on their own rate", () => {
    expect(getPricingForModel("gemini", "gemini-4-carbon")).toMatchObject({ input: 2, output: 10 });
  });
});

describe("Gemini 4 Hydrogen in the Antigravity MITM tool", () => {
  const tool = MITM_TOOLS.antigravity;

  it("offers every Hydrogen tier as a mappable IDE slot", () => {
    for (const [id] of AG_TIERS) {
      expect(tool.modelAliases).toContain(id);
      expect(tool.defaultModels.find((m) => m.alias === id)).toBeTruthy();
    }
  });

  it("is not captured by another slot's fallback pattern", () => {
    for (const [id] of AG_TIERS) {
      expect(MODEL_PATTERNS.antigravity.some(({ match }) => match.test(id))).toBe(false);
    }
  });
});
