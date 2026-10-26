// claude-to-openai emits prompt_tokens already folded (input + cache_read +
// cache_creation) and keeps the cache fields; canonicalizing it must not fold
// the cache a second time (dashboard showed Claude cache capped at ~50%).
import { describe, it, expect } from "vitest";
import { canonicalizeUsage } from "../../open-sse/utils/usageTracking.js";
import { initState } from "../../open-sse/translator/index.js";
import { claudeToOpenAIResponse } from "../../open-sse/translator/response/claude-to-openai.js";

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

describe("canonicalizeUsage: OpenAI passthrough is unchanged", () => {
  it("keeps a cache-inclusive prompt_tokens with top-level cached_tokens", () => {
    const out = canonicalizeUsage({ prompt_tokens: 9150, completion_tokens: 10, cached_tokens: 9000 });
    expect(out.prompt_tokens).toBe(9150);
    expect(out.cached_tokens).toBe(9000);
    expect(out.total_tokens).toBe(9160);
  });

  it("keeps a cache-inclusive prompt_tokens with prompt_tokens_details", () => {
    const out = canonicalizeUsage({ prompt_tokens: 9150, completion_tokens: 10, total_tokens: 9160, prompt_tokens_details: { cached_tokens: 9000, cache_creation_tokens: 50 } });
    expect(out.prompt_tokens).toBe(9150);
    expect(out.cached_tokens).toBe(9000);
    expect(out.cache_creation_input_tokens).toBe(50);
  });
});

// End to end through the translator: both the state the tracker reads and the
// usage chunk sent to the client must canonicalize to the same totals, whether
// the stream ends with message_delta or straight with message_stop (#5050).
describe("claude-to-openai usage through canonicalizeUsage", () => {
  const start = {
    type: "message_start",
    message: { id: "msg_1", model: "claude-sonnet-5-5", usage: { input_tokens: 100, cache_read_input_tokens: 9000, cache_creation_input_tokens: 50, output_tokens: 0 } },
  };
  const expectFolded = (usage) => {
    const out = canonicalizeUsage(usage);
    expect(out.prompt_tokens).toBe(9150);
    expect(out.cached_tokens).toBe(9000);
    expect(out.cache_creation_input_tokens).toBe(50);
  };

  it("message_start + message_delta", () => {
    const state = initState("claude");
    claudeToOpenAIResponse(start, state);
    const out = claudeToOpenAIResponse({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 10 } }, state);
    expectFolded(state.usage);
    expectFolded(out[out.length - 1].usage);
  });

  it("message_start + message_stop without message_delta", () => {
    const state = initState("claude");
    claudeToOpenAIResponse(start, state);
    claudeToOpenAIResponse({ type: "message_stop" }, state);
    expectFolded(state.usage);
  });
});
