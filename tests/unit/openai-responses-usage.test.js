/**
 * Responses API clients (Codex, sub2api /v1/responses) read token usage only from
 * `response.completed → response.usage`. For chat-native upstreams (Qoder, most
 * OpenAI-compatible providers) the translator used to emit that event without usage,
 * so proxies logged 0 input / 0 output / 0 cached tokens.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(() => {}),
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { initState } = await import("../../open-sse/translator/index.js");
const { toResponsesUsage } = await import("../../open-sse/translator/concerns/usage.js");
const { openaiToOpenAIResponsesResponse } = await import("../../open-sse/translator/response/openai-responses.js");
const { createSSETransformStreamWithLogger } = await import("../../open-sse/utils/stream.js");
const { createResponsesApiTransformStream } = await import("../../open-sse/transformer/responsesTransformer.js");
const { addBufferToUsage } = await import("../../open-sse/utils/usageTracking.js");
// stream.js adds the same context-safety buffer it applies to chat/claude clients
const BUFFER_TOKENS = addBufferToUsage({ prompt_tokens: 0 }).prompt_tokens;

const QODER_FINISH_CHUNK = {
  id: "chatcmpl-qoder-1",
  object: "chat.completion.chunk",
  created: 1_700_000_000,
  model: "qmodel_38max",
  choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  usage: {
    prompt_tokens: 27_339,
    completion_tokens: 437,
    total_tokens: 27_776,
    prompt_tokens_details: { cached_tokens: 27_200 },
  },
};

function sse(chunks) {
  return chunks.map((c) => `data: ${typeof c === "string" ? c : JSON.stringify(c)}\n\n`).join("");
}

async function pipe(input, transform) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(input));
      controller.close();
    },
  });
  const reader = stream.pipeThrough(transform).getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function completedEvent(text) {
  const m = text.match(/event: response\.completed\ndata: (.+)\n/);
  return m ? JSON.parse(m[1]) : null;
}

describe("toResponsesUsage", () => {
  it("maps OpenAI usage (nested cached_tokens) to the Responses shape", () => {
    expect(toResponsesUsage(QODER_FINISH_CHUNK.usage)).toEqual({
      input_tokens: 27_339,
      output_tokens: 437,
      total_tokens: 27_776,
      input_tokens_details: { cached_tokens: 27_200 },
      output_tokens_details: { reasoning_tokens: 0 },
    });
  });

  it("accepts canonical flat fields and Claude-style cache fields", () => {
    expect(toResponsesUsage({ prompt_tokens: 10, completion_tokens: 2, cached_tokens: 4, reasoning_tokens: 1 })).toMatchObject({
      input_tokens: 10,
      output_tokens: 2,
      total_tokens: 12,
      input_tokens_details: { cached_tokens: 4 },
      output_tokens_details: { reasoning_tokens: 1 },
    });
    expect(toResponsesUsage({ input_tokens: 5, output_tokens: 1, cache_read_input_tokens: 3 }).input_tokens_details.cached_tokens).toBe(3);
  });

  it("keeps the estimated marker and returns null for empty usage", () => {
    expect(toResponsesUsage({ prompt_tokens: 1, completion_tokens: 1, estimated: true }).estimated).toBe(true);
    expect(toResponsesUsage({})).toBeNull();
    expect(toResponsesUsage(null)).toBeNull();
  });
});

describe("openai → openai-responses translator", () => {
  it("puts usage from the finish chunk on response.completed", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    const events = openaiToOpenAIResponsesResponse(QODER_FINISH_CHUNK, state);
    const completed = events.find((e) => e.event === "response.completed");
    expect(completed).toBeTruthy();
    expect(completed.data.response.usage).toEqual({
      input_tokens: 27_339,
      output_tokens: 437,
      total_tokens: 27_776,
      input_tokens_details: { cached_tokens: 27_200 },
      output_tokens_details: { reasoning_tokens: 0 },
    });
  });

  it("omits usage when the upstream never reported any", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    const events = openaiToOpenAIResponsesResponse({ ...QODER_FINISH_CHUNK, usage: undefined }, state);
    const completed = events.find((e) => e.event === "response.completed");
    expect(completed.data.response.usage).toBeUndefined();
  });
});

describe("stream.js translate mode: chat upstream → Responses client", () => {
  const transform = () => createSSETransformStreamWithLogger(
    FORMATS.OPENAI,             // provider (Qoder executor emits OpenAI chunks)
    FORMATS.OPENAI_RESPONSES,   // client
    "qoder",
    null,
    null,
    "qmodel_38max",
    null,
    { model: "qd/qmodel_38max", messages: [{ role: "user", content: "hi" }] },
  );

  it("emits provider usage (+buffer) with cached tokens on response.completed", async () => {
    const out = await pipe(sse([
      { ...QODER_FINISH_CHUNK, choices: [{ index: 0, delta: { role: "assistant", content: "Hello" }, finish_reason: null }], usage: undefined },
      QODER_FINISH_CHUNK,
      "[DONE]",
    ]), transform());

    const completed = completedEvent(out);
    expect(completed).toBeTruthy();
    expect(completed.response.usage).toEqual({
      input_tokens: 27_339 + BUFFER_TOKENS,
      output_tokens: 437,
      total_tokens: 27_776 + BUFFER_TOKENS,
      input_tokens_details: { cached_tokens: 27_200 },
      output_tokens_details: { reasoning_tokens: 0 },
    });
    // Responses clients terminate on response.completed (no [DONE] sentinel in translate mode)
    expect(out.indexOf("event: response.completed")).toBeGreaterThan(out.indexOf("event: response.output_item.done"));
  });

  it("injects estimated usage when the upstream reports none", async () => {
    const out = await pipe(sse([
      { ...QODER_FINISH_CHUNK, choices: [{ index: 0, delta: { role: "assistant", content: "Hello world" }, finish_reason: null }], usage: undefined },
      { ...QODER_FINISH_CHUNK, usage: undefined },
      "[DONE]",
    ]), transform());

    const completed = completedEvent(out);
    expect(completed.response.usage).toBeTruthy();
    expect(completed.response.usage.estimated).toBe(true);
    expect(completed.response.usage.input_tokens).toBeGreaterThan(0);
    expect(completed.response.usage.output_tokens).toBeGreaterThan(0);
  });
});

describe("responsesTransformer (Chat SSE → Codex Responses SSE)", () => {
  it("forwards finish-chunk usage on response.completed", async () => {
    const out = await pipe(sse([
      { ...QODER_FINISH_CHUNK, choices: [{ index: 0, delta: { role: "assistant", content: "Hello" }, finish_reason: null }], usage: undefined },
      QODER_FINISH_CHUNK,
      "[DONE]",
    ]), createResponsesApiTransformStream());

    const completed = completedEvent(out);
    expect(completed.response.usage).toMatchObject({
      input_tokens: 27_339,
      output_tokens: 437,
      input_tokens_details: { cached_tokens: 27_200 },
    });
  });
});
