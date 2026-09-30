import { describe, expect, it } from "vitest";

import { getModelsByProviderId } from "../../open-sse/config/providerModels.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";

// Sonnet 5.5 keeps Sonnet 5's API price ($2 / $10 per 1M) and the 5.x
// adaptive-thinking family. Without explicit rows both fell through to the
// generic claude-sonnet-* pattern: $3 / $15 and budget thinking.
describe("Claude Sonnet 5.5", () => {
  it("is listed for the claude provider", () => {
    expect(getModelsByProviderId("claude").some((model) => model.id === "claude-sonnet-5-5")).toBe(true);
  });

  it("resolves to adaptive thinking with a 1M context", () => {
    expect(getCapabilitiesForModel("claude", "claude-sonnet-5-5")).toMatchObject({
      reasoning: true,
      thinkingFormat: "claude-adaptive",
      contextWindow: 1000000,
      maxOutput: 128000,
    });
  });

  it.each(["claude-sonnet-5-5", "claude-sonnet-5"])("prices %s at Sonnet 5 rates", (model) => {
    expect(getPricingForModel("claude", model)).toEqual({ input: 2, output: 10, cached: 0.2, reasoning: 10, cache_creation: 2.5 });
  });
});
