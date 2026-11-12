import { describe, it, expect } from "vitest";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";

describe("Claude Fable pricing", () => {
  it("prices Fable 5.2 at $8/$40 with $0.20 cache reads", () => {
    expect(getPricingForModel("claude", "claude-fable-5-2")).toMatchObject({ input: 8, output: 40, cached: 0.2, cache_creation: 10 });
  });

  it("prices Fable 5.1 at $10/$50 instead of the generic claude-* fallback", () => {
    expect(getPricingForModel("claude", "claude-fable-5-1")).toMatchObject({ input: 10, output: 50, cached: 1, cache_creation: 12.5 });
  });
});
