// Reasoning tokens are billed ONCE.
//
// OpenAI Chat Completions and the Responses API report reasoning_tokens as a
// SUBSET of completion/output tokens (openai-to-claude.js documents the same
// invariant). Gemini/Antigravity is different: thoughtsTokenCount is NOT part
// of candidatesTokenCount. The usage extractor marks the inclusive families so
// calculateCostFromTokens never prices the reasoning slice twice.
import { describe, it, expect } from "vitest";
import { extractUsage, mergeUsage, canonicalizeUsage } from "../../open-sse/utils/usageTracking.js";
import { calculateCostFromTokens } from "../../open-sse/providers/pricing.js";

const PRICING = { input: 1.25, output: 10, reasoning: 10, cached: 0.625, cache_creation: 1.25 };

function costOfChunk(chunk) {
  return calculateCostFromTokens(canonicalizeUsage(extractUsage(chunk)), PRICING);
}

describe("reasoning tokens are charged once", () => {
  it("OpenAI chat: completion_tokens already includes reasoning_tokens", () => {
    const chunk = {
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 500,
        completion_tokens_details: { reasoning_tokens: 300 },
      },
    };
    // 1000 * 1.25 + 500 * 10 (reasoning is part of the 500) = 0.00625
    expect(costOfChunk(chunk)).toBeCloseTo(0.00625, 12);
  });

  it("OpenAI Responses: output_tokens already includes reasoning_tokens", () => {
    const chunk = {
      type: "response.completed",
      response: {
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
          output_tokens_details: { reasoning_tokens: 300 },
        },
      },
    };
    expect(costOfChunk(chunk)).toBeCloseTo(0.00625, 12);
  });

  it("keeps the marker across a streamed merge (flag survives mergeUsage)", () => {
    const first = extractUsage({
      usage: { prompt_tokens: 1000, completion_tokens: 500, completion_tokens_details: { reasoning_tokens: 300 } },
    });
    const second = extractUsage({ usage: { prompt_tokens: 1000, completion_tokens: 500 } });
    const merged = mergeUsage(first, second);
    expect(calculateCostFromTokens(canonicalizeUsage(merged), PRICING)).toBeCloseTo(0.00625, 12);
  });

  it("Gemini: thoughtsTokenCount is separate from candidatesTokenCount (still billed additively)", () => {
    const chunk = {
      usageMetadata: {
        promptTokenCount: 1000,
        candidatesTokenCount: 500,
        thoughtsTokenCount: 300,
        totalTokenCount: 1800,
      },
    };
    // 1000 * 1.25 + 500 * 10 + 300 * 10 = 0.00925
    expect(costOfChunk(chunk)).toBeCloseTo(0.00925, 12);
  });

  it("Claude: output_tokens already covers thinking and carries no reasoning field", () => {
    const start = extractUsage({
      type: "message_start",
      message: { usage: { input_tokens: 1000, output_tokens: 1 } },
    });
    const delta = extractUsage({ type: "message_delta", usage: { output_tokens: 500 } });
    const merged = mergeUsage(start, delta);
    expect(merged.reasoning_tokens).toBeUndefined();
    expect(calculateCostFromTokens(canonicalizeUsage(merged), PRICING)).toBeCloseTo(0.00625, 12);
  });

  it("usage without the marker (unknown family) keeps the additive behaviour", () => {
    // A caller that cannot tell whether reasoning is a subset (e.g. a raw
    // tokens object from a non-instrumented extractor) must not lose the
    // separate reasoning charge.
    const cost = calculateCostFromTokens(
      { prompt_tokens: 1000, completion_tokens: 500, reasoning_tokens: 300 },
      PRICING
    );
    expect(cost).toBeCloseTo(0.00925, 12);
  });

  it("raw OpenAI usage details are not double-charged (SSE-to-JSON path)", () => {
    // sseToJsonHandler passes the upstream usage object straight through. The
    // raw object carries reasoning nested-only, and canonicalizeUsage reads
    // only top-level reasoning_tokens, so the full completion is charged once.
    // Behaviour lock: this already held before the subset marker existed.
    const canonical = canonicalizeUsage({
      prompt_tokens: 1000,
      completion_tokens: 500,
      completion_tokens_details: { reasoning_tokens: 300 },
    });
    expect(calculateCostFromTokens(canonical, PRICING)).toBeCloseTo(0.00625, 12);
  });

  it("honours a distinct reasoning rate without double-counting the output slice", () => {
    const pricing = { input: 1, output: 6, reasoning: 9 };
    const cost = calculateCostFromTokens(
      { prompt_tokens: 0, completion_tokens: 500, reasoning_tokens: 300, reasoning_included_in_output: 1 },
      pricing
    );
    // (500 - 300) * 6 + 300 * 9 = 3900 / 1e6
    expect(cost).toBeCloseTo(0.0039, 12);
  });
});
