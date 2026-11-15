import { describe, expect, it, vi } from "vitest";
import { createRequire } from "module";

vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn() }));
vi.mock("open-sse/services/usage/google.js", () => ({ getAntigravityUsage: vi.fn() }));

import { getModelUpstreamId, isValidModel } from "../../open-sse/config/providerModels.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { getCapabilitiesForModel, isGemini4Model } from "../../open-sse/providers/capabilities.js";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { applyThinking, stripThinkingSuffix } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { openaiToGeminiRequest } from "../../open-sse/translator/request/openai-to-gemini.js";
import { MITM_TOOLS } from "../../src/shared/constants/cliTools.js";
import { getAntigravityModelFamily, getAntigravityModelQuota } from "../../src/sse/services/antigravityQuota.js";

const require = createRequire(import.meta.url);
const { MODEL_SYNONYMS, MODEL_PATTERNS } = require("../../src/mitm/config.js");

const AG_TIERS = ["xhigh", "high", "medium", "low"];

describe("Gemini 4 Hydrogen registry", () => {
  it("is served by the Gemini API provider", () => {
    expect(isValidModel("gemini", "gemini-4-hydrogen")).toBe(true);
  });

  it.each(AG_TIERS)("registers the Antigravity %s tier and the bare alias", (tier) => {
    expect(isValidModel("ag", `gemini-4-hydrogen-${tier}`)).toBe(true);
    expect(isValidModel("ag", "gemini-4-hydrogen")).toBe(true);
  });
});

describe("Gemini 4 Hydrogen capabilities", () => {
  it.each([
    ["gemini", "gemini-4-hydrogen"],
    ["antigravity", "gemini-4-hydrogen-high"],
    ["antigravity", "gemini-4-hydrogen-xhigh"],
  ])("declares always-on level reasoning and multimodal input on %s/%s", (provider, model) => {
    const caps = getCapabilitiesForModel(provider, model);
    expect(caps).toMatchObject({
      reasoning: true,
      thinkingFormat: "gemini-level",
      thinkingCanDisable: false,
      vision: true,
      pdf: true,
      audioInput: true,
      videoInput: true,
      contextWindow: 1048576,
      maxOutput: 65536,
    });
    expect(getThinkingLevels(provider, model)).toEqual(["low", "medium", "high", "xhigh"]);
  });

  it("keeps Carbon/Argon on low/medium/high (no xhigh)", () => {
    expect(getThinkingLevels("gemini", "gemini-4-argon")).toEqual(["low", "medium", "high"]);
    expect(getThinkingLevels("antigravity", "gemini-4-carbon-high")).toEqual(["low", "medium", "high"]);
  });

  it("is treated as Gemini 4 for sampling-param removal", () => {
    expect(isGemini4Model("gemini-4-hydrogen")).toBe(true);
    const out = openaiToGeminiRequest("gemini-4-hydrogen", {
      messages: [{ role: "user", content: "hi" }],
      temperature: 0.2,
      top_p: 0.5,
      top_k: 10,
    }, false);
    expect(out.generationConfig.temperature).toBeUndefined();
    expect(out.generationConfig.topP).toBeUndefined();
    expect(out.generationConfig.topK).toBeUndefined();
  });
});

describe("Gemini 4 Hydrogen thinking levels on the wire", () => {
  const thinkingFor = (body, model = "gemini-4-hydrogen", provider = "gemini") => {
    applyThinking("gemini", model, body, provider);
    return body.generationConfig.thinkingConfig;
  };

  it("passes xhigh through instead of collapsing it to high", () => {
    expect(thinkingFor({ reasoning_effort: "xhigh" })).toEqual({ thinkingLevel: "xhigh", includeThoughts: true });
  });

  it.each(["max", "ultra"])("caps reasoning_effort %s at xhigh", (effort) => {
    expect(thinkingFor({ reasoning_effort: effort }).thinkingLevel).toBe("xhigh");
  });

  it("accepts an explicit (xhigh) model suffix", () => {
    expect(thinkingFor({}, "gemini-4-hydrogen(xhigh)").thinkingLevel).toBe("xhigh");
  });

  it.each(["low", "medium", "high"])("passes %s through untouched", (effort) => {
    expect(thinkingFor({ reasoning_effort: effort }).thinkingLevel).toBe(effort);
  });

  // "minimal" is a live 400 on Hydrogen: "Thinking level MINIMAL is not supported for this model."
  it("clamps reasoning_effort none to low", () => {
    expect(thinkingFor({ reasoning_effort: "none" })).toEqual({ thinkingLevel: "low", includeThoughts: true });
  });

  it("clamps a small Claude thinking budget to low", () => {
    expect(thinkingFor({ thinking: { type: "enabled", budget_tokens: 512 } }).thinkingLevel).toBe("low");
  });

  it("still collapses xhigh to high on Argon (regression guard)", () => {
    expect(thinkingFor({ reasoning_effort: "xhigh" }, "gemini-4-argon").thinkingLevel).toBe("high");
  });

  it("maps ultra to high (not the lowest level) on models without xhigh", () => {
    expect(thinkingFor({ reasoning_effort: "ultra" }, "gemini-4-argon").thinkingLevel).toBe("high");
  });

  it("raises maxOutputTokens to the 64K output cap for xhigh", () => {
    const body = { reasoning_effort: "xhigh", generationConfig: { maxOutputTokens: 1024 } };
    applyThinking("gemini", "gemini-4-hydrogen", body, "gemini");
    expect(body.generationConfig.maxOutputTokens).toBe(65535);
  });
});

describe("Gemini 4 Hydrogen Antigravity tiers", () => {
  const wire = (modelId, upstreamModel) => {
    const body = {
      model: stripThinkingSuffix(upstreamModel),
      request: { contents: [{ role: "user", parts: [{ text: "hello" }] }], generationConfig: {} },
    };
    applyThinking("antigravity", upstreamModel, body, "antigravity");
    return new AntigravityExecutor().transformRequest(modelId, body, true, { projectId: "project", connectionId: "connection" });
  };

  it.each(AG_TIERS)("maps gemini-4-hydrogen-%s to its wire model and thinking level", (tier) => {
    const modelId = `gemini-4-hydrogen-${tier}`;
    const upstreamModel = getModelUpstreamId("ag", modelId);
    expect(upstreamModel).toBe(`${modelId}(${tier})`);

    const finalBody = wire(modelId, upstreamModel);
    expect(finalBody.model).toBe(modelId);
    expect(finalBody.request.generationConfig.thinkingConfig).toEqual({ thinkingLevel: tier, includeThoughts: true });
  });

  it("resolves the bare id to the default high tier", () => {
    expect(getModelUpstreamId("ag", "gemini-4-hydrogen")).toBe("gemini-4-hydrogen-high(high)");
  });

  it.each([
    [{ reasoning_effort: "xhigh" }, "gemini-4-hydrogen-xhigh(xhigh)"],
    [{ reasoning_effort: "max" }, "gemini-4-hydrogen-xhigh(xhigh)"],
    [{ reasoning: { effort: "xhigh" } }, "gemini-4-hydrogen-xhigh(xhigh)"],
    [{ reasoning_effort: "medium" }, "gemini-4-hydrogen-medium(medium)"],
    [{ reasoning_effort: "minimal" }, "gemini-4-hydrogen-low(low)"],
  ])("picks the tier from client effort %j", (clientBody, expected) => {
    expect(getModelUpstreamId("ag", "gemini-4-hydrogen", clientBody)).toBe(expected);
  });

  it("routes an explicit (xhigh) suffix on the bare id to the xhigh tier", () => {
    expect(getModelUpstreamId("ag", "gemini-4-hydrogen(xhigh)")).toBe("gemini-4-hydrogen-xhigh(xhigh)");
  });

  it("keeps collapsing xhigh to high for families without an xhigh tier", () => {
    expect(getModelUpstreamId("ag", "gemini-4-carbon", { reasoning_effort: "xhigh" })).toBe("gemini-4-carbon-high(high)");
    expect(getModelUpstreamId("ag", "gemini-3.8-flash", { reasoning_effort: "max" })).toBe("gemini-3.8-flash-high(high)");
  });

  it("does not reroute standalone -xhigh ids on other providers", () => {
    expect(getModelUpstreamId("ws", "gpt-5.4", { reasoning_effort: "xhigh" })).toBe("gpt-5.4");
  });

  it("does not pick up a tier on the Gemini API provider", () => {
    expect(getModelUpstreamId("gemini", "gemini-4-hydrogen", { reasoning_effort: "xhigh" })).toBe("gemini-4-hydrogen");
  });
});

describe("Gemini 4 Hydrogen pricing", () => {
  const HYDROGEN = { input: 1.5, output: 7.5, cached: 0.075, reasoning: 7.5, cache_creation: 1.5 };

  it.each([
    ["gemini", "gemini-4-hydrogen"],
    ["antigravity", "gemini-4-hydrogen-xhigh"],
    ["antigravity", "gemini-4-hydrogen-low"],
  ])("bills %s/%s at the Hydrogen rate", (provider, model) => {
    expect(getPricingForModel(provider, model)).toEqual(HYDROGEN);
  });

  it("leaves the other Gemini 4 models on the family rate", () => {
    expect(getPricingForModel("gemini", "gemini-4-argon")).toMatchObject({ input: 2, output: 10 });
  });
});

describe("Gemini 4 Hydrogen Antigravity quota", () => {
  it("shares the main Gemini quota bucket", () => {
    expect(getAntigravityModelFamily("gemini-4-hydrogen-xhigh")).toBe("gemini");
  });

  it("resolves the bare id to the high tier's per-model quota", () => {
    const high = { remainingPercentage: 40 };
    expect(getAntigravityModelQuota({ "gemini-4-hydrogen-high": high }, "gemini-4-hydrogen")).toBe(high);
  });
});

describe("Gemini 4 Hydrogen Antigravity IDE (MITM) slots", () => {
  it.each(AG_TIERS)("offers a mappable %s slot", (tier) => {
    const id = `gemini-4-hydrogen-${tier}`;
    expect(MITM_TOOLS.antigravity.modelAliases).toContain(id);
    expect(MITM_TOOLS.antigravity.defaultModels.find((m) => m.id === id)).toMatchObject({ alias: id });
  });

  it("maps the bare id to the high slot", () => {
    expect(MODEL_SYNONYMS.antigravity["gemini-4-hydrogen"]).toBe("gemini-4-hydrogen-high");
  });

  it.each(AG_TIERS)("is not hijacked by a fallback pattern (%s)", (tier) => {
    expect(MODEL_PATTERNS.antigravity.some(({ match }) => match.test(`gemini-4-hydrogen-${tier}`))).toBe(false);
  });
});
