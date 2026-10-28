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

  it("surfaces OpenAI Responses output_tokens_details.reasoning_tokens", () => {
    const out = extractUsageFromResponse({
      usage: { input_tokens: 100, output_tokens: 20,
        output_tokens_details: { reasoning_tokens: 12 } },
    });
    expect(canonicalizeUsage(out).reasoning_tokens).toBe(12);
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

  // Ollama non-streaming: prompt_eval_count/eval_count/prompt_eval_cached_count
  // live at the top level of the response body (not nested under `usage`).
  it("extracts Ollama top-level prompt_eval_count/eval_count", () => {
    const out = extractUsageFromResponse({
      model: "gpt-oss:120b",
      done: true,
      done_reason: "stop",
      prompt_eval_count: 26,
      eval_count: 282,
    });
    expect(out.prompt_tokens).toBe(26);
    expect(out.completion_tokens).toBe(282);
    expect(out.total_tokens).toBe(308);
    expect(out.cached_tokens).toBe(0);
  });

  it("extracts Ollama prompt_eval_cached_count as cached_tokens", () => {
    const out = extractUsageFromResponse({
      model: "gpt-oss:120b",
      done: true,
      prompt_eval_count: 100,
      eval_count: 20,
      prompt_eval_cached_count: 80,
    });
    expect(out.prompt_tokens).toBe(100); // cache-INCLUSIVE
    expect(out.completion_tokens).toBe(20);
    expect(out.cached_tokens).toBe(80);
    // canonicalize passes cache-INCLUSIVE prompt through unchanged
    const canon = canonicalizeUsage(out);
    expect(canon.prompt_tokens).toBe(100);
    expect(canon.cached_tokens).toBe(80);
    expect(canon.total_tokens).toBe(120);
  });

  it("returns null for an Ollama-shaped body missing done flag", () => {
    // Non-final Ollama chunk (done:false) carries no usage — must not match.
    expect(extractUsageFromResponse({ model: "x", done: false, prompt_eval_count: 5 }))
      .toBeNull();
  });
});
