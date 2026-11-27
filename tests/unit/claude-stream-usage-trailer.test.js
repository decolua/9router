// Regression tests for #5596: OpenAI's usage-only trailer must reach Claude
// clients in the terminal message_delta, with cache counters converted.
import { describe, expect, it } from "vitest";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const directState = () => ({
  toolCalls: new Map(),
  nextBlockIndex: 0,
  // stream.js sets this on the direct OpenAI -> Claude route.
  targetFormat: FORMATS.OPENAI,
});

const content = (state) => openaiToClaudeResponse({
  id: "chatcmpl-cache-test",
  model: "deepseek-v4.1-flash",
  choices: [{ delta: { content: "PONG" }, finish_reason: null }],
}, state) || [];

const finish = (state) => openaiToClaudeResponse({
  choices: [{ delta: {}, finish_reason: "stop" }],
}, state) || [];

const trailer = (state, usage) => openaiToClaudeResponse({
  choices: [],
  usage,
}, state) || [];

describe("openai -> claude terminal usage", () => {
  it("waits for the usage trailer and reports cache reads in message_delta", () => {
    const state = directState();
    const beforeFinish = [...content(state), ...finish(state)];
    expect(beforeFinish.some(e => e.type === "message_delta")).toBe(false);
    expect(beforeFinish.some(e => e.type === "message_stop")).toBe(false);

    const events = trailer(state, {
      prompt_tokens: 8505,
      completion_tokens: 16,
      prompt_tokens_details: { cached_tokens: 8448 },
    });
    const delta = events.find(e => e.type === "message_delta");
    expect(delta.delta.stop_reason).toBe("end_turn");
    expect(delta.usage).toEqual({
      input_tokens: 57,
      output_tokens: 16,
      cache_read_input_tokens: 8448,
    });
    expect(events.filter(e => e.type === "message_stop")).toHaveLength(1);
  });

  it("does not emit a duplicate terminal on stream flush", () => {
    const state = directState();
    content(state);
    finish(state);
    trailer(state, { prompt_tokens: 100, completion_tokens: 5 });
    expect(openaiToClaudeResponse(null, state)).toBeNull();
  });

  it("flushes the terminal with zero usage when no trailer arrives", () => {
    const state = directState();
    content(state);
    finish(state);
    const events = openaiToClaudeResponse(null, state) || [];
    expect(events.find(e => e.type === "message_delta").usage).toEqual({
      input_tokens: 0,
      output_tokens: 0,
    });
    expect(events.filter(e => e.type === "message_stop")).toHaveLength(1);
  });

  it("converts cache creation counters and clamps negative input", () => {
    const state = directState();
    content(state);
    finish(state);
    const events = trailer(state, {
      prompt_tokens: 100,
      completion_tokens: 25,
      prompt_tokens_details: { cached_tokens: 80, cache_creation_tokens: 40 },
    });
    expect(events.find(e => e.type === "message_delta").usage).toEqual({
      input_tokens: 0,
      output_tokens: 25,
      cache_read_input_tokens: 80,
      cache_creation_input_tokens: 40,
    });
  });

  it("keeps the immediate terminal when usage is on the finish chunk", () => {
    const state = directState();
    content(state);
    const events = openaiToClaudeResponse({
      choices: [{ delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 5, cached_tokens: 90 },
    }, state) || [];
    expect(events.find(e => e.type === "message_delta").usage).toEqual({
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 90,
    });
  });

  it("keeps the immediate terminal on pivot routes (non-direct)", () => {
    const state = { toolCalls: new Map(), nextBlockIndex: 0, targetFormat: FORMATS.MISTRAL };
    content(state);
    const events = finish(state);
    expect(events.filter(e => e.type === "message_stop")).toHaveLength(1);
    expect(openaiToClaudeResponse(null, state)).toBeNull();
  });
});
