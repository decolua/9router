import { describe, expect, it, vi, beforeEach } from "vitest";

// --- P1 helper tests (pure) ---
import { isXaiReasoningRequest } from "../../open-sse/utils/streamHandler.js";

describe("isXaiReasoningRequest", () => {
  it("returns true when reasoning_effort is present", () => {
    expect(isXaiReasoningRequest("xai", "grok-4.3", { reasoning_effort: "high" })).toBe(true);
  });

  it("returns true for model suffix -reasoning", () => {
    expect(isXaiReasoningRequest("xai", "grok-4.20-reasoning", {})).toBe(true);
  });

  it("returns true for model alias -high", () => {
    expect(isXaiReasoningRequest("xai", "grok-4.3-high", {})).toBe(true);
  });

  it("returns false for plain xAI model without reasoning_effort", () => {
    expect(isXaiReasoningRequest("xai", "grok-4.3", {})).toBe(false);
  });

  it("returns false for non-xai providers even with reasoning_effort", () => {
    expect(isXaiReasoningRequest("openai", "o3", { reasoning_effort: "high" })).toBe(false);
  });
});

// --- P3: DefaultExecutor passes response_format through for xAI (structured output) ---
import { DefaultExecutor } from "../../open-sse/executors/default.js";

describe("DefaultExecutor xAI structured output passthrough", () => {
  it("does not strip or rewrite response_format for raw xai provider", () => {
    const exec = new DefaultExecutor("xai");
    const body = {
      model: "grok-4.3",
      messages: [{ role: "user", content: "hi" }],
      response_format: { type: "json_object" },
    };
    const out = exec.transformRequest("grok-4.3", body);
    expect(out.response_format).toEqual({ type: "json_object" });
    expect(out.model).toBe("grok-4.3");
  });
});

// --- P2: xAI stream usage per-chunk parsing ---
// xAI sends OpenAI-compatible `usage` on streaming chunks. The stream pipeline
// keeps the latest extracted usage snapshot, so test extraction and last-wins
// accumulation directly instead of depending on WebStream backpressure timing.
import { extractUsage } from "../../open-sse/utils/usageTracking.js";

describe("xAI streaming usage per-chunk", () => {
  it("extracts xAI OpenAI-compatible streaming usage including cached/reasoning details", () => {
    const usage = extractUsage({
      choices: [{ delta: { content: "hi" }, finish_reason: null }],
      usage: {
        prompt_tokens: 11,
        completion_tokens: 7,
        prompt_tokens_details: { cached_tokens: 3 },
        completion_tokens_details: { reasoning_tokens: 2 },
      },
    });

    expect(usage).toMatchObject({
      prompt_tokens: 11,
      completion_tokens: 7,
      cached_tokens: 3,
      reasoning_tokens: 2,
      prompt_tokens_details: { cached_tokens: 3 },
      completion_tokens_details: { reasoning_tokens: 2 },
    });
  });

  it("uses the latest streaming usage snapshot without summing per-chunk cumulative counts", () => {
    let usage = null;
    for (const chunk of [
      { usage: { prompt_tokens: 10, completion_tokens: 1 } },
      { usage: { prompt_tokens: 10, completion_tokens: 4 } },
      { usage: { prompt_tokens: 10, completion_tokens: 6 } },
    ]) {
      const extracted = extractUsage(chunk);
      if (extracted) usage = extracted;
    }

    expect(usage).toMatchObject({ prompt_tokens: 10, completion_tokens: 6 });
  });
});
