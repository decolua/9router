/**
 * Usage regressions on the openai-responses -> claude route (a Responses client such
 * as Codex talking to an Anthropic-compatible connection). There is no direct
 * `openai-responses:claude` translator, so the request pivots
 * openai-responses -> openai -> claude and the response comes back
 * claude -> openai -> openai-responses.
 *
 * 1. Token double-count. claude-to-openai folds Claude's cache-exclusive
 *    input_tokens into a cache-inclusive prompt_tokens on the shared stream
 *    state, but did not set the top-level `cached_tokens` key that
 *    canonicalizeUsage() uses as its already-folded marker, so the recorded
 *    usage folded the cache totals a second time (one request with 483,711
 *    prompt tokens was stored as 967,422).
 *
 * 2. message_stop reported a cache-exclusive prompt_tokens. Streams that end
 *    without a stop_reason-bearing message_delta read input_tokens as
 *    prompt_tokens and emitted no cache details at all.
 */
import { describe, expect, it } from "vitest";

import { claudeToOpenAIResponse } from "../../open-sse/translator/response/claude-to-openai.js";
import { canonicalizeUsage } from "../../open-sse/utils/usageTracking.js";
import { initState, translateResponse } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const freshState = () => ({ id: "chatcmpl-test", created: 0, model: "claude-sonnet-4-5" });

// Drive the streaming translator the way stream.js does: one shared state
// object across message_start -> message_delta.
function runClaudeStream(startUsage, deltaUsage) {
  const state = freshState();
  claudeToOpenAIResponse({ type: "message_start", message: { model: "claude-sonnet-4-5", usage: startUsage } }, state);
  claudeToOpenAIResponse({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: deltaUsage }, state);
  return state.usage;
}

describe("claude-to-openai usage is canonicalizeUsage-idempotent", () => {
  it("does not fold cache_read into prompt_tokens a second time", () => {
    const usage = runClaudeStream(
      { input_tokens: 0, cache_read_input_tokens: 481799, cache_creation_input_tokens: 1912 },
      { output_tokens: 640 }
    );

    expect(usage.prompt_tokens).toBe(483711);
    expect(usage.cached_tokens).toBe(481799);

    const canonical = canonicalizeUsage(usage);
    expect(canonical.prompt_tokens).toBe(483711); // was 967,422
    expect(canonical.cached_tokens).toBe(481799);
    expect(canonical.cache_creation_input_tokens).toBe(1912);
    expect(canonical.completion_tokens).toBe(640);
  });

  it("marks a cache-creation-only first write as folded too (cached_tokens 0)", () => {
    // The marker must be set unconditionally: gating it on cache_read > 0
    // leaves first-write requests (creation only, no read) double-folded.
    const usage = runClaudeStream(
      { input_tokens: 12, cache_creation_input_tokens: 8000 },
      { output_tokens: 30 }
    );

    expect(usage.prompt_tokens).toBe(8012);
    expect(usage.cached_tokens).toBe(0);
    expect(canonicalizeUsage(usage).prompt_tokens).toBe(8012); // was 16,012
  });

  it("leaves a no-cache request untouched through both folds", () => {
    const usage = runClaudeStream({ input_tokens: 500 }, { output_tokens: 20 });
    expect(usage.prompt_tokens).toBe(500);
    expect(usage.cached_tokens).toBe(0);
    expect(canonicalizeUsage(usage).prompt_tokens).toBe(500);
  });
});

describe("message_stop reports a cache-inclusive prompt_tokens", () => {
  function runToStop(startUsage, deltaUsage) {
    const state = freshState();
    claudeToOpenAIResponse({ type: "message_start", message: { model: "claude-sonnet-4-5", usage: startUsage } }, state);
    if (deltaUsage) claudeToOpenAIResponse({ type: "message_delta", delta: {}, usage: deltaUsage }, state);
    return claudeToOpenAIResponse({ type: "message_stop" }, state)?.[0];
  }

  it("folds cache into prompt_tokens and reports the cache details", () => {
    const chunk = runToStop(
      { input_tokens: 12, cache_read_input_tokens: 481799, cache_creation_input_tokens: 1912 },
      { output_tokens: 640 }
    );

    expect(chunk.usage.prompt_tokens).toBe(483723); // was 12
    expect(chunk.usage.completion_tokens).toBe(640);
    expect(chunk.usage.total_tokens).toBe(484363);
    expect(chunk.usage.prompt_tokens_details).toEqual({
      cached_tokens: 481799,
      cache_creation_tokens: 1912
    });
  });

  it("still reports a plain no-cache request unchanged", () => {
    const chunk = runToStop({ input_tokens: 500 }, { output_tokens: 20 });
    expect(chunk.usage.prompt_tokens).toBe(500);
    expect(chunk.usage.completion_tokens).toBe(20);
    expect(chunk.usage).not.toHaveProperty("prompt_tokens_details");
  });

  it("emits no usage when the upstream reported none", () => {
    const chunk = runToStop(undefined, undefined);
    expect(chunk).toBeDefined();
    expect("usage" in chunk).toBe(false);
  });
});

describe("response.completed usage on the claude -> openai-responses pivot", () => {
  // Guards that the already-folded marker does not leak into the Responses
  // usage the client sizes its context from.
  function runPivot(startUsage, deltaUsage) {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    const events = [];
    const push = (chunk) => events.push(...translateResponse(FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES, chunk, state));

    push({ type: "message_start", message: { id: "msg_1", model: "claude-sonnet-4-5", usage: startUsage } });
    push({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
    push({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hello" } });
    push({ type: "content_block_stop", index: 0 });
    push({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: deltaUsage });
    push(null);

    return events.find(e => e.event === "response.completed")?.data?.response;
  }

  it("reports cache-inclusive Responses usage once", () => {
    const response = runPivot(
      { input_tokens: 12, cache_read_input_tokens: 481799, cache_creation_input_tokens: 1912 },
      { output_tokens: 640 }
    );

    expect(response.usage.prompt_tokens).toBeUndefined();
    expect(response.usage.input_tokens).toBe(483723);
    expect(response.usage.output_tokens).toBe(640);
    expect(response.usage.total_tokens).toBe(484363);
    expect(response.usage.input_tokens_details).toEqual({ cached_tokens: 481799 });
  });
});
