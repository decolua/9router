// Non-streaming OpenAI responses price reasoning once (it is a subset of
// completion_tokens), except for upstreams that report it on top (xAI-style:
// total_tokens === prompt + completion + reasoning).
import { describe, expect, it } from "vitest";
import { extractUsageFromResponse } from "../../open-sse/handlers/chatCore/requestDetail.js";
import { extractUsage } from "../../open-sse/utils/usageTracking.js";
import { calculateCostFromTokens } from "../../open-sse/providers/pricing.js";

const PRICING = { input: 1.25, output: 10, reasoning: 10 };
const subset = { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500, completion_tokens_details: { reasoning_tokens: 300 } };
const additive = { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1500, completion_tokens_details: { reasoning_tokens: 300 } };

describe("reasoning tokens are priced once on non-streaming OpenAI responses", () => {
  it("subset reporting: output + reasoning cost equals completion_tokens", () => {
    const usage = extractUsageFromResponse({ usage: subset });
    expect(usage.reasoning_included_in_output).toBe(1);
    expect(calculateCostFromTokens(usage, PRICING)).toBeCloseTo(0.00625, 8);
  });

  it("additive reporting (total = prompt + completion + reasoning) stays additive", () => {
    const usage = extractUsageFromResponse({ usage: additive });
    expect(usage.reasoning_included_in_output).toBeUndefined();
    expect(calculateCostFromTokens(usage, PRICING)).toBeCloseTo(0.00625, 8);
  });

  it("streaming extractor applies the same additive exception", () => {
    expect(extractUsage({ usage: subset }).reasoning_included_in_output).toBe(1);
    expect(extractUsage({ usage: additive }).reasoning_included_in_output).toBeUndefined();
  });
});
