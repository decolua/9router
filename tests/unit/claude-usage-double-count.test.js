// claude-to-openai emits prompt_tokens already folded (input + cache_read +
// cache_creation) and keeps the cache fields; canonicalizing it must not fold
// the cache a second time (dashboard showed Claude cache capped at ~50%).
import { describe, it, expect } from "vitest";
import { canonicalizeUsage } from "../../open-sse/utils/usageTracking.js";

describe("canonicalizeUsage: Claude cache folding", () => {
  it("folds raw Claude usage once", () => {
    const out = canonicalizeUsage({ input_tokens: 4, cache_read_input_tokens: 82244, cache_creation_input_tokens: 2036, output_tokens: 10 });
    expect(out.prompt_tokens).toBe(84284);
    expect(out.cached_tokens).toBe(82244);
  });

  it("does not re-fold usage translated by claude-to-openai", () => {
    const out = canonicalizeUsage({ prompt_tokens: 84284, input_tokens: 4, completion_tokens: 10, total_tokens: 84294, output_tokens: 10, cache_read_input_tokens: 82244, cache_creation_input_tokens: 2036 });
    expect(out.prompt_tokens).toBe(84284);
    expect(out.cached_tokens).toBe(82244);
  });
});
