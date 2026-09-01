import { describe, expect, it } from "vitest";

import { initState, translateResponse } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import {
  openaiResponsesToOpenAIRequest,
} from "../../open-sse/translator/request/openai-responses.js";
import {
  openaiToOpenAIResponsesResponse,
} from "../../open-sse/translator/response/openai-responses.js";

// The LIVE /v1/responses path for a chat-completions upstream runs through
// these translators (stream.js → translateResponse/translateRequest), NOT
// the legacy responsesHandler transformer. Assert the same billing
// evidence here: response.completed carries model + usage, usage chunk
// captured before completion, completion deferred to flush.

const MODEL = "z-ai/glm-5.3-flash";

const USAGE = {
  prompt_tokens: 9452,
  prompt_tokens_details: { cached_tokens: 1280 },
  completion_tokens: 32,
  completion_tokens_details: { reasoning_tokens: 7 },
  total_tokens: 9484
};

function runTranslator(chunks) {
  const state = { ...initState(FORMATS.OPENAI_RESPONSES) };
  const batches = chunks.map((chunk) => openaiToOpenAIResponsesResponse(chunk, state));
  const flushBatch = openaiToOpenAIResponsesResponse(null, state); // stream.js flush
  return { batches, flushBatch };
}

function completedFrom(batch) {
  const ev = (batch || []).find((item) => item?.event === "response.completed");
  return ev ? ev.data : null;
}

function streamWithUsage({ withModel = true, withUsage = true } = {}) {
  const chunks = [
    {
      ...(withModel ? { model: MODEL } : {}),
      id: "chatcmpl-gate",
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { role: "assistant", content: "Hello" }, finish_reason: null }]
    },
    {
      ...(withModel ? { model: MODEL } : {}),
      id: "chatcmpl-gate",
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
    }
  ];
  if (withUsage) {
    // include_usage final chunk: usage with EMPTY choices, AFTER finish_reason.
    chunks.push({
      ...(withModel ? { model: MODEL } : {}),
      id: "chatcmpl-gate",
      object: "chat.completion.chunk",
      choices: [],
      usage: USAGE
    });
  }
  return chunks;
}

describe("live-path translator usage + model evidence", () => {
  it("request translation asks the upstream for include_usage when streaming", () => {
    const body = {
      model: "daiserver",
      instructions: "sys",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
      stream: true
    };
    const out = openaiResponsesToOpenAIRequest("glm/glm-5.3-flash", body, true, {});
    expect(out.stream_options).toEqual({ include_usage: true });
    expect(out.messages[0]).toEqual({ role: "system", content: "sys" });
  });

  it("request translation leaves non-streaming requests untouched", () => {
    const body = {
      model: "daiserver",
      instructions: "sys",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
      stream: false
    };
    const out = openaiResponsesToOpenAIRequest("glm/glm-5.3-flash", body, false, {});
    expect(out.stream_options).toBeUndefined();
  });

  it("response.completed (at flush) carries model and the full mapped usage", () => {
    const { batches, flushBatch } = runTranslator(streamWithUsage());

    // Completion is deferred past finish_reason: no completed event until flush.
    for (const batch of batches) {
      expect(completedFrom(batch)).toBeNull();
    }
    const completed = completedFrom(flushBatch);
    expect(completed).not.toBeNull();
    expect(completed.response.model).toBe(MODEL);
    expect(completed.response.usage).toEqual({
      input_tokens: 9452,
      input_tokens_details: { cached_tokens: 1280 },
      output_tokens: 32,
      output_tokens_details: { reasoning_tokens: 7 },
      total_tokens: 9484
    });
  });

  it("upstream ignoring include_usage still completes cleanly, usage omitted, model present", () => {
    const { batches, flushBatch } = runTranslator(streamWithUsage({ withUsage: false }));
    for (const batch of batches) {
      expect(completedFrom(batch)).toBeNull();
    }
    const completed = completedFrom(flushBatch);
    expect(completed).not.toBeNull();
    expect(completed.response.model).toBe(MODEL);
    expect(completed.response.usage).toBeUndefined();
  });

  it("upstream never sending model omits the field — no null/empty leak", () => {
    const { flushBatch } = runTranslator(streamWithUsage({ withModel: false }));
    const completed = completedFrom(flushBatch);
    expect(completed).not.toBeNull();
    expect(completed.response.usage).toBeDefined();
    expect(completed.response.model).toBeUndefined();
    expect(JSON.stringify(completed.response)).not.toMatch(/"model"\s*:\s*(null|"")/);
  });
});

// The production glm connection speaks the CLAUDE transport, so the live
// wire is a 2-hop translation claude→openai→responses through the hub.
// This is the path the deployed gateway actually serves.
describe("live-path claude→responses 2-hop (production glm transport)", () => {
  it("flush cascades through the openai hub: completed carries model+usage", () => {
    const state = { ...initState(FORMATS.OPENAI_RESPONSES) };
    const claudeChunks = [
      { type: "message_start", message: { id: "msg_g", model: "glm-5.3-flash", usage: { input_tokens: 9000, cache_read_input_tokens: 1280 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ready" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 32 } },
      { type: "message_stop" }
    ];

    const batches = claudeChunks.map((c) =>
      translateResponse(FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES, c, state));

    // Completion deferred: nothing terminal until the flush call.
    for (const batch of batches) {
      expect((batch || []).find((i) => i?.event === "response.completed")).toBeUndefined();
    }

    const flush = translateResponse(FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES, null, state);
    const ev = (flush || []).find((i) => i?.event === "response.completed");
    expect(ev).toBeTruthy();
    expect(ev.data.response.model).toBe("glm-5.3-flash");
    // prompt side = input + cache_read (claude semantics), mapped via
    // toOpenAIUsage → prompt_tokens_details.cached_tokens.
    expect(ev.data.response.usage.input_tokens).toBe(10280);
    expect(ev.data.response.usage.input_tokens_details.cached_tokens).toBe(1280);
    expect(ev.data.response.usage.output_tokens).toBe(32);
    expect(ev.data.response.usage.total_tokens).toBe(10312);
  });
});
