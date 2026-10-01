import { describe, it, expect, vi } from "vitest";

// sever the DB import chain (usageDb -> @/lib/db/*) — not under test
vi.mock("@/lib/usageDb.js", () => ({
  saveRequestUsage: vi.fn(),
  appendRequestLog: vi.fn(),
  saveRequestDetail: vi.fn(),
}));
// and the stream/console-coloring utils that drag in the translator graph
vi.mock("../../open-sse/utils/stream.js", () => ({
  COLORS: {},
  formatSSE: vi.fn(),
}));

import { extractUsageFromResponse } from "../../open-sse/handlers/chatCore/requestDetail.js";
import { canonicalizeUsage } from "../../open-sse/utils/usageTracking.js";

// The three real-world usage shapes and how extractUsageFromResponse() must
// surface their cache-read count so canonicalizeUsage() produces a correct
// cached_tokens. Regression for non-streaming codex/Responses traffic, where
// cache reads were silently dropped and usage recorded cached_tokens: 0.
describe("extractUsageFromResponse cache surfaces", () => {
  it("surfaces OpenAI Responses input_tokens_details.cached_tokens", () => {
    // codex / /v1/responses shape: prompt is cache-INCLUSIVE
    const out = extractUsageFromResponse({
      usage: { input_tokens: 25421, output_tokens: 5, total_tokens: 25426,
               input_tokens_details: { cached_tokens: 24320 } },
    });
    expect(out.cached_tokens).toBe(24320);
    expect(out.prompt_tokens).toBe(25421);
    expect(out.cache_read_input_tokens).toBeUndefined();
  });

  it("canonicalizes Responses usage without double-counting the prompt", () => {
    const extracted = extractUsageFromResponse({
      usage: { input_tokens: 25421, output_tokens: 5,
               input_tokens_details: { cached_tokens: 24320 } },
    });
    const out = canonicalizeUsage(extracted);
    // inclusive prompt passes through unchanged; cache reported as subset
    expect(out.prompt_tokens).toBe(25421);
    expect(out.cached_tokens).toBe(24320);
    expect(out.total_tokens).toBe(25426);
    expect(out.cache_creation_input_tokens).toBe(0);
  });

  it("still folds genuine Claude exclusive cache (regression)", () => {
    const extracted = extractUsageFromResponse({
      usage: { input_tokens: 100, output_tokens: 50,
               cache_read_input_tokens: 200, cache_creation_input_tokens: 30 },
    });
    expect(extracted.cached_tokens).toBeUndefined();
    const out = canonicalizeUsage(extracted);
    expect(out.prompt_tokens).toBe(330); // 100 + 200 + 30
    expect(out.cached_tokens).toBe(200);
    expect(out.cache_creation_input_tokens).toBe(30);
  });

  it("surfaces flat cached_tokens on the OpenAI branch (SSE-to-JSON shape)", () => {
    const out = extractUsageFromResponse({
      usage: { prompt_tokens: 300, completion_tokens: 10, cached_tokens: 240 },
    });
    expect(out.cached_tokens).toBe(240);
  });

  it("keeps nested prompt_tokens_details.cached_tokens working (regression)", () => {
    const out = extractUsageFromResponse({
      usage: { prompt_tokens: 300, completion_tokens: 10,
               prompt_tokens_details: { cached_tokens: 240 } },
    });
    expect(out.cached_tokens).toBe(240);
    expect(canonicalizeUsage(out).cached_tokens).toBe(240);
  });
});
