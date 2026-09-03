import { describe, expect, it } from "vitest";
import { canonicalizeUsage } from "../../open-sse/utils/usageTracking.js";

describe("canonicalizeUsage nested prompt_tokens_details (#2873)", () => {
  it("reads cached_tokens from nested prompt_tokens_details (buildUsage shape)", () => {
    const out = canonicalizeUsage({
      prompt_tokens: 27985,
      completion_tokens: 60,
      total_tokens: 28045,
      prompt_tokens_details: { cached_tokens: 27136 },
    });
    expect(out.cached_tokens).toBe(27136);
    // prompt already includes cache in the OpenAI shape; keep as-is
    expect(out.prompt_tokens).toBe(27985);
  });

  it("prefers top-level cached_tokens when both are present", () => {
    const out = canonicalizeUsage({
      prompt_tokens: 100,
      completion_tokens: 10,
      cached_tokens: 90,
      prompt_tokens_details: { cached_tokens: 50 },
    });
    expect(out.cached_tokens).toBe(90);
  });

  it("does not break the Claude fold path", () => {
    const out = canonicalizeUsage({
      input_tokens: 100,
      output_tokens: 20,
      cache_read_input_tokens: 30,
      cache_creation_input_tokens: 5,
    });
    // prompt = input + cacheRead + cacheCreation
    expect(out.prompt_tokens).toBe(135);
    expect(out.cached_tokens).toBe(30);
    expect(out.cache_creation_input_tokens).toBe(5);
  });
});
