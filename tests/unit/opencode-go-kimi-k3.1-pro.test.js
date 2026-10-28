import { describe, expect, it } from "vitest";
import { getModelsByProviderId } from "../../open-sse/config/providerModels.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";

// Values from https://opencode.ai/docs/go/ (endpoint table and pricing, 2026-10-23).
describe("OpenCode Go Kimi K3.1 Pro", () => {
  it("is listed on the chat completions lane", () => {
    const entry = getModelsByProviderId("opencode-go").find((m) => m.id === "kimi-k3.1-pro");
    expect(entry).toMatchObject({ name: "Kimi K3.1 Pro", supportedFormats: ["openai"] });
  });

  it("reports a 1M context window with always-on Kimi thinking", () => {
    expect(getCapabilitiesForModel("opencode-go", "kimi-k3.1-pro")).toMatchObject({
      vision: true, reasoning: true, thinkingFormat: "kimi", thinkingCanDisable: false,
      contextWindow: 1048576, maxOutput: 131072,
    });
  });

  it("is priced as K3.1 Pro, not by the kimi-k3* wildcard", () => {
    expect(getPricingForModel("opencode-go", "kimi-k3.1-pro")).toMatchObject({
      input: 2.0, output: 10.0, cached: 0.2,
    });
  });
});
