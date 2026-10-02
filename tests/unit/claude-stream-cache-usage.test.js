// A Claude stream translated to OpenAI chat chunks must surface the prompt-cache
// split to the client and log it without double-counting. Observed on a live
// gateway: Anthropic answered input_tokens=13 / cache_read_input_tokens=22548,
// the client received prompt_tokens=24561 with no prompt_tokens_details (cache
// billed at full price by the caller), and the usage log recorded 45109 prompt
// tokens (cache folded into an already cache-inclusive prompt).
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  saveRequestUsage: vi.fn(),
  appendRequestLog: vi.fn(),
  saveRequestDetail: vi.fn(),
  trackPendingRequest: vi.fn(),
}));

import { claudeToOpenAIResponse } from "../../open-sse/translator/response/claude-to-openai.js";
import { addBufferToUsage, canonicalizeUsage, filterUsageForFormat } from "../../open-sse/utils/usageTracking.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

function runStream(state) {
  const start = claudeToOpenAIResponse({
    type: "message_start",
    message: {
      id: "msg_011abc",
      model: "claude-opus-5",
      usage: { input_tokens: 13, output_tokens: 1, cache_read_input_tokens: 22548, cache_creation_input_tokens: 0 },
    },
  }, state);
  const delta = claudeToOpenAIResponse({
    type: "message_delta",
    delta: { stop_reason: "end_turn" },
    usage: { output_tokens: 6 },
  }, state);
  return { start, final: delta.at(-1) };
}

describe("claude -> openai stream usage keeps the cache split", () => {
  it("final chunk carries a cache-inclusive prompt and prompt_tokens_details.cached_tokens", () => {
    const { final } = runStream({});
    expect(final.usage).toEqual({
      prompt_tokens: 22561,
      completion_tokens: 6,
      total_tokens: 22567,
      prompt_tokens_details: { cached_tokens: 22548 },
    });
  });

  it("state.usage survives the stream.js client re-emit (buffer + OpenAI field filter)", () => {
    const state = {};
    runStream(state);
    const client = filterUsageForFormat(addBufferToUsage(state.usage), FORMATS.OPENAI);
    expect(client.prompt_tokens_details).toEqual({ cached_tokens: 22548 });
    expect(client.cached_tokens).toBe(22548);
    expect(client.prompt_tokens).toBe(22561 + 2000);
    expect(client.cache_read_input_tokens).toBeUndefined();
  });

  it("state.usage canonicalizes for logging without folding the cache twice", () => {
    const state = {};
    runStream(state);
    const logged = canonicalizeUsage(state.usage);
    expect(logged.prompt_tokens).toBe(22561);
    expect(logged.cached_tokens).toBe(22548);
    expect(logged.cache_creation_input_tokens).toBe(0);
  });

  it("reports a cache write on the first turn", () => {
    const state = {};
    claudeToOpenAIResponse({
      type: "message_start",
      message: { id: "msg_1", model: "m", usage: { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 500 } },
    }, state);
    const final = claudeToOpenAIResponse({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } }, state).at(-1);
    expect(final.usage.prompt_tokens).toBe(510);
    expect(final.usage.prompt_tokens_details).toEqual({ cache_creation_tokens: 500 });
    expect(canonicalizeUsage(state.usage).prompt_tokens).toBe(510);
  });
});
