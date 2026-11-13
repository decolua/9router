// Regression for #5030 — the usage object 9Router sends to an OpenAI client
// carried no `prompt_tokens_details.cached_tokens`, so a client that meters
// cost from the response saw a 0% cache hit even though the upstream request
// WAS prompt-cached.
//
// Anthropic sends the cache counters in `message_start` and only the output
// counter in `message_delta`. The `message_stop` branch rebuilt the usage by
// hand from `input_tokens` alone, dropping the cache counters whenever the
// stream ended without a `message_delta`.
import { describe, it, expect } from "vitest";

import { initState } from "../../open-sse/translator/index.js";
import { claudeToOpenAIResponse } from "../../open-sse/translator/response/claude-to-openai.js";

const START_USAGE = {
  input_tokens: 100,
  cache_read_input_tokens: 9000,
  cache_creation_input_tokens: 50,
  output_tokens: 0,
};

function startChunk() {
  return {
    type: "message_start",
    message: { id: "msg_1", model: "claude-sonnet-5-5", usage: { ...START_USAGE } },
  };
}

function lastUsage(out) {
  const chunk = out?.[out.length - 1];
  return chunk?.usage || null;
}

describe("claude→openai response — cache tokens in the usage object", () => {
  it("reports cached_tokens when the stream ends with message_stop", () => {
    const state = initState("claude");
    claudeToOpenAIResponse(startChunk(), state);

    const out = claudeToOpenAIResponse({ type: "message_stop" }, state);
    const usage = lastUsage(out);

    expect(usage).not.toBeNull();
    expect(usage.prompt_tokens_details.cached_tokens).toBe(9000);
    expect(usage.prompt_tokens_details.cache_creation_tokens).toBe(50);
  });

  it("counts the cache tokens in prompt_tokens", () => {
    const state = initState("claude");
    claudeToOpenAIResponse(startChunk(), state);

    const out = claudeToOpenAIResponse({ type: "message_stop" }, state);
    const usage = lastUsage(out);

    // prompt_tokens = input + cache_read + cache_creation
    expect(usage.prompt_tokens).toBe(9150);
    expect(usage.total_tokens).toBe(usage.prompt_tokens + usage.completion_tokens);
  });

  it("keeps the cache counters when the stream ends with message_delta", () => {
    const state = initState("claude");
    claudeToOpenAIResponse(startChunk(), state);

    const out = claudeToOpenAIResponse(
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 25 } },
      state,
    );
    const usage = lastUsage(out);

    expect(usage.prompt_tokens_details.cached_tokens).toBe(9000);
    expect(usage.completion_tokens).toBe(25);
  });

  it("omits the details block when nothing was cached", () => {
    const state = initState("claude");
    claudeToOpenAIResponse({
      type: "message_start",
      message: { id: "msg_1", model: "claude-sonnet-5-5", usage: { input_tokens: 100, output_tokens: 0 } },
    }, state);

    const out = claudeToOpenAIResponse({ type: "message_stop" }, state);
    const usage = lastUsage(out);

    expect(usage.prompt_tokens).toBe(100);
    expect(usage.prompt_tokens_details).toBeUndefined();
  });

  it("emits no usage at all when the stream carried none", () => {
    const state = initState("claude");

    const out = claudeToOpenAIResponse({ type: "message_stop" }, state);

    expect(lastUsage(out)).toBeNull();
  });
});
