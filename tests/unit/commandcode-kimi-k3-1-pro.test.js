import { describe, expect, it } from "vitest";

import { getModelsByProviderId, isValidModel } from "../../open-sse/config/providerModels.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";
import { parseModel } from "../../open-sse/services/model.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import "../translator/registerAll.js";

// Command Code serves Kimi K3.1 Pro on /alpha/generate. registry id must match
// the upstream wire id verbatim (capitalized, per GET api.commandcode.ai/provider/v1/models).
const KIMI_K31_PRO = "moonshotai/Kimi-K3.1-Pro";

describe("Command Code Kimi K3.1 Pro", () => {
  it("is listed for the commandcode provider", () => {
    expect(getModelsByProviderId("commandcode").some((model) => model.id === KIMI_K31_PRO)).toBe(true);
    expect(isValidModel("commandcode", KIMI_K31_PRO)).toBe(true);
  });

  it("resolves provider capabilities instead of a family pattern", () => {
    expect(getCapabilitiesForModel("commandcode", KIMI_K31_PRO)).toMatchObject({
      reasoning: true,
      thinkingFormat: "commandcode",
      thinkingEffortSupported: true,
      contextWindow: 1000000,
      maxOutput: 384000,
    });
  });

  it("prices at the Kimi K3 tier", () => {
    expect(getPricingForModel("commandcode", KIMI_K31_PRO)).toEqual({
      input: 3,
      output: 15,
      cached: 0.3,
      reasoning: 15,
      cache_creation: 3,
    });
  });

  it("routes cmc/<model> to the commandcode wire without rewriting the id", () => {
    expect(parseModel(`cmc/${KIMI_K31_PRO}`)).toMatchObject({
      provider: "commandcode",
      model: KIMI_K31_PRO,
    });

    const out = translateRequest(
      FORMATS.OPENAI,
      FORMATS.COMMANDCODE,
      KIMI_K31_PRO,
      { model: KIMI_K31_PRO, messages: [{ role: "user", content: "hi" }] },
      true,
      null,
      "cmc",
    );
    expect(out.params.model).toBe(KIMI_K31_PRO);
  });
});
