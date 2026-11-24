// tests/unit/pricing-source.test.js
import { describe, it, expect } from "vitest";
import { resolvePricing, getPricingForModel } from "../../open-sse/providers/pricing.js";

describe("resolvePricing", () => {
  it("names where the price comes from", () => {
    expect(resolvePricing("cc", "claude-opus-5-5").source).toBe("model");
    expect(resolvePricing("gemini", "gemini-4-argon").source).toBe("pattern");
    expect(resolvePricing("gemini", "gemini-4-argon").pricing.input).toBe(2);
    expect(resolvePricing("cline", "cline-free/x").source).toBe("free");
    expect(resolvePricing("gemini", "unpriced-test-model")).toEqual({ pricing: null, source: "none" });
    expect(resolvePricing("gemini", "")).toEqual({ pricing: null, source: "none" });
  });
  it("a provider-specific price wins and is reported as such", () => {
    const r = resolvePricing("tokenrouter", "google/gemma-4-26b-a4b-it");
    expect(r.source).toBe("provider");
  });
  it("getPricingForModel is unchanged: same value as resolvePricing().pricing", () => {
    for (const [p, m] of [["cc", "claude-opus-5-5"], ["gemini", "gemini-4-argon"], ["gemini", "unpriced-test-model"], ["cline", "cline-free/x"], ["openai", "gpt-4"]]) {
      expect(getPricingForModel(p, m)).toEqual(resolvePricing(p, m).pricing);
    }
  });
});
