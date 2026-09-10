import { describe, expect, it } from "vitest";
import { claudeUsageToOpenAI } from "../../open-sse/utils/usageTracking.js";

describe("Claude non-streaming usage translation", () => {
  it("includes cache reads and cache writes in OpenAI prompt totals", () => {
    const translated = claudeUsageToOpenAI({
      input_tokens: 11,
      output_tokens: 3,
      cache_read_input_tokens: 7,
      cache_creation_input_tokens: 5,
    });

    expect(translated).toEqual({
      prompt_tokens: 23,
      completion_tokens: 3,
      total_tokens: 26,
      prompt_tokens_details: {
        cached_tokens: 7,
        cache_creation_tokens: 5,
      },
    });
  });

  it("does not add empty prompt details when Claude reports no cache usage", () => {
    const translated = claudeUsageToOpenAI({ input_tokens: 11, output_tokens: 3 });

    expect(translated).toEqual({
      prompt_tokens: 11,
      completion_tokens: 3,
      total_tokens: 14,
    });
  });
});
