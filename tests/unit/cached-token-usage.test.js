import { describe, it, expect } from "vitest";
import { canonicalizeUsage } from "../../open-sse/utils/usageTracking.js";
import { calculateCostFromTokens } from "../../open-sse/providers/pricing.js";
import { toOpenAIUsage } from "../../open-sse/translator/concerns/usage.js";

// Canonical convention (single source of truth for storage + cost):
//   prompt_tokens             = total input INCLUDING cache read + cache creation
//   cached_tokens             = cache-read portion (subset of prompt_tokens)
//   cache_creation_input_tokens = cache-write portion (subset of prompt_tokens)
//   completion_tokens         = output
// Discriminator: Claude reports cache separately (prompt EXCLUDES cache);
// OpenAI/Gemini report prompt INCLUDING cached_tokens.
describe("canonicalizeUsage", () => {
  it("folds Claude exclusive cache into an inclusive prompt count", () => {
    // Claude: input_tokens excludes cache; cache_read + cache_creation are separate
    const out = canonicalizeUsage({
      prompt_tokens: 100,
      completion_tokens: 50,
      cache_read_input_tokens: 200,
      cache_creation_input_tokens: 30,
    });
    expect(out.prompt_tokens).toBe(330); // 100 + 200 + 30
    expect(out.completion_tokens).toBe(50);
    expect(out.cached_tokens).toBe(200);
    expect(out.cache_creation_input_tokens).toBe(30);
  });

  it("passes through OpenAI inclusive prompt unchanged", () => {
    // OpenAI: prompt_tokens already includes cached_tokens (a subset)
    const out = canonicalizeUsage({
      prompt_tokens: 330,
      completion_tokens: 50,
      cached_tokens: 200,
    });
    expect(out.prompt_tokens).toBe(330);
    expect(out.cached_tokens).toBe(200);
    expect(out.cache_creation_input_tokens).toBe(0);
  });

  it("passes through Gemini inclusive prompt (cachedContent already counted)", () => {
    const out = canonicalizeUsage({
      prompt_tokens: 500,
      completion_tokens: 80,
      cached_tokens: 120,
      reasoning_tokens: 40,
    });
    expect(out.prompt_tokens).toBe(500);
    expect(out.cached_tokens).toBe(120);
    expect(out.reasoning_tokens).toBe(40);
  });

  it("handles no-cache usage", () => {
    const out = canonicalizeUsage({ prompt_tokens: 100, completion_tokens: 50 });
    expect(out.prompt_tokens).toBe(100);
    expect(out.cached_tokens).toBe(0);
    expect(out.cache_creation_input_tokens).toBe(0);
  });

  it("is idempotent (running twice yields the same canonical shape)", () => {
    const once = canonicalizeUsage({
      prompt_tokens: 100,
      completion_tokens: 50,
      cache_read_input_tokens: 200,
      cache_creation_input_tokens: 30,
    });
    const twice = canonicalizeUsage(once);
    expect(twice.prompt_tokens).toBe(330);
    expect(twice.cached_tokens).toBe(200);
    expect(twice.cache_creation_input_tokens).toBe(30);
    expect(twice.completion_tokens).toBe(50);
  });

  it("returns null for invalid input", () => {
    expect(canonicalizeUsage(null)).toBeNull();
    expect(canonicalizeUsage(undefined)).toBeNull();
  });
});

describe("calculateCostFromTokens (canonical inclusive convention)", () => {
  const pricing = { input: 3, output: 15, cached: 0.3, cache_creation: 3.75 };

  it("prices cached + cache_creation as subsets of an inclusive prompt without double-counting", () => {
    // prompt=330 includes 200 cached + 30 cache_creation → 100 full-price input
    const cost = calculateCostFromTokens(
      { prompt_tokens: 330, completion_tokens: 50, cached_tokens: 200, cache_creation_input_tokens: 30 },
      pricing
    );
    const expected =
      (100 * 3 + 200 * 0.3 + 30 * 3.75 + 50 * 15) / 1_000_000;
    expect(cost).toBeCloseTo(expected, 12);
  });

  it("does not let cache_creation drive nonCached negative", () => {
    // pathological: cached + creation exceeds prompt → nonCached clamps at 0
    const cost = calculateCostFromTokens(
      { prompt_tokens: 100, completion_tokens: 0, cached_tokens: 80, cache_creation_input_tokens: 40 },
      pricing
    );
    const expected = (0 * 3 + 80 * 0.3 + 40 * 3.75) / 1_000_000;
    expect(cost).toBeCloseTo(expected, 12);
  });

  it("matches plain input pricing when no cache present", () => {
    const cost = calculateCostFromTokens({ prompt_tokens: 100, completion_tokens: 50 }, pricing);
    expect(cost).toBeCloseTo((100 * 3 + 50 * 15) / 1_000_000, 12);
  });
});

describe("Kiro usage pass-through", () => {
  it("passes through plain input/output when no cache fields are present", () => {
    const out = toOpenAIUsage({ inputTokens: 100, outputTokens: 50 }, "kiro");
    expect(out.prompt_tokens).toBe(100);
    expect(out.completion_tokens).toBe(50);
    expect(out.total_tokens).toBe(150);
    expect(out.prompt_tokens_details).toBeUndefined();
  });

  it("forward-compat: surfaces cache fields if Kiro event shape grows them", () => {
    // ponytail: Amazon Q upstream doesn't expose cache today, but if it starts
    // sending cache_read_input_tokens / cache_creation_input_tokens / cachedTokens,
    // cost tracking should pick them up automatically without another change.
    const out = toOpenAIUsage(
      { inputTokens: 500, outputTokens: 100, cache_read_input_tokens: 200, cache_creation_input_tokens: 50 },
      "kiro"
    );
    expect(out.prompt_tokens_details).toBeDefined();
    expect(out.prompt_tokens_details.cached_tokens).toBe(200);
    expect(out.prompt_tokens_details.cache_creation_tokens).toBe(50);
  });
});
