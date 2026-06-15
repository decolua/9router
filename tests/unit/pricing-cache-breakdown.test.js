import { describe, expect, it } from "vitest";
import {
  MODEL_PRICING,
  calculateCostBreakdownFromTokens,
  calculateCostFromTokens,
  getPricingForModel,
} from "../../open-sse/providers/pricing.js";

describe("pricing cache breakdown", () => {
  it("uses exact standard API pricing for current OpenAI models", () => {
    expect(MODEL_PRICING["gpt-5.5"]).toMatchObject({ input: 5.00, cached: 0.50, output: 30.00 });
    expect(MODEL_PRICING["gpt-5.4"]).toMatchObject({ input: 2.50, cached: 0.25, output: 15.00 });
    expect(MODEL_PRICING["gpt-5.4-mini"]).toMatchObject({ input: 0.75, cached: 0.075, output: 4.50 });
    expect(MODEL_PRICING["gpt-5"]).toMatchObject({ input: 1.25, cached: 0.125, output: 10.00 });
    expect(MODEL_PRICING["gpt-4.1"]).toMatchObject({ input: 2.00, cached: 0.50, output: 8.00 });
  });

  it("does not price full gpt-4o variants as gpt-4o-mini", () => {
    expect(getPricingForModel("openai", "gpt-4o-2024-08-06")).toMatchObject({ input: 2.50, cached: 1.25, output: 10.00 });
    expect(getPricingForModel("openai", "gpt-4o-mini-2024-07-18")).toMatchObject({ input: 0.15, cached: 0.075, output: 0.60 });
  });

  it("charges cached and uncached input at different rates", () => {
    const pricing = getPricingForModel("openai", "gpt-5.4-mini");
    const breakdown = calculateCostBreakdownFromTokens({
      prompt_tokens: 1000,
      completion_tokens: 100,
      cache_read_input_tokens: 800,
    }, pricing);

    expect(breakdown.promptTokens).toBe(1000);
    expect(breakdown.uncachedPromptTokens).toBe(200);
    expect(breakdown.cacheReadTokens).toBe(800);
    expect(breakdown.uncachedInputCost).toBeCloseTo((200 * 0.75) / 1_000_000, 12);
    expect(breakdown.cachedInputCost).toBeCloseTo((800 * 0.075) / 1_000_000, 12);
    expect(breakdown.outputCost).toBeCloseTo((100 * 4.50) / 1_000_000, 12);
    expect(calculateCostFromTokens({
      prompt_tokens: 1000,
      completion_tokens: 100,
      cache_read_input_tokens: 800,
    }, pricing)).toBeCloseTo(((200 * 0.75) + (800 * 0.075) + (100 * 4.50)) / 1_000_000, 12);
  });

  it("treats reasoning tokens as included output details by default", () => {
    const pricing = getPricingForModel("openai", "gpt-5.5");
    const breakdown = calculateCostBreakdownFromTokens({
      prompt_tokens: 1000,
      completion_tokens: 100,
      reasoning_tokens: 40,
    }, pricing);

    expect(breakdown.reasoningTokens).toBe(40);
    expect(breakdown.outputCost).toBeCloseTo((100 * 30.00) / 1_000_000, 12);
    expect(breakdown.totalCost).toBeCloseTo(((1000 * 5.00) + (100 * 30.00)) / 1_000_000, 12);
  });

  it("supports providers that report input and cache buckets separately", () => {
    const breakdown = calculateCostBreakdownFromTokens({
      input_tokens: 1000,
      output_tokens: 100,
      cache_read_input_tokens: 800,
      cache_creation_input_tokens: 200,
    }, { input: 3.00, cached: 0.30, cache_creation: 3.75, output: 15.00 });

    expect(breakdown.promptTokens).toBe(2000);
    expect(breakdown.uncachedPromptTokens).toBe(1000);
    expect(breakdown.cacheReadTokens).toBe(800);
    expect(breakdown.cacheCreationTokens).toBe(200);
    expect(breakdown.inputCost).toBeCloseTo(((1000 * 3.00) + (800 * 0.30) + (200 * 3.75)) / 1_000_000, 12);
  });
});
