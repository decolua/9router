import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// RED contract: optional onStreamTerminal(outcome), never onStreamComplete(content).
// Outcome contains only outcome, errorClass?, statusCode?, partialResponse.
// requestSignal is the ORIGINAL client signal, not the executor's internal signal.
// No event sink replacement: dispatcher remains its owner, even in this suite.
const deps = vi.hoisted(() => ({
  execute: vi.fn(),
  logger: {
    logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn(),
    appendProviderChunk: vi.fn(), appendConvertedChunk: vi.fn(), appendOpenAIChunk: vi.fn(),
  },
}));

// Persistence and HTTP are external effects; parsers, translators and controllers stay real.
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}),
}));
vi.mock("open-sse/executors/index.js", () => ({
  getExecutor: () => ({ execute: deps.execute, noAuth: true }),
}));
vi.mock("open-sse/utils/requestLogger.js", () => ({ createRequestLogger: async () => deps.logger }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));

import { FORMATS } from "open-sse/translator/formats.js";
import { createSSEStream } from "open-sse/utils/stream.js";
import { createStreamController, pipeWithDisconnect } from "open-sse/utils/streamHandler.js";
import { handleStreamingResponse } from "open-sse/handlers/chatCore/streamingHandler.js";
import { handleForcedSSEToJson } from "open-sse/handlers/chatCore/sseToJsonHandler.js";
import { handleNonStreamingResponse } from "open-sse/handlers/chatCore/nonStreamingHandler.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import {
  runWithWebhookContext, markWebhookAdmitted, captureWebhookFinalizer, getWebhookContext,
} from "@/lib/webhooks/events.js";

const encoder = new TextEncoder();
const MODEL = "fixture-model";
const DONE = "data: [DONE]\n\n";
const PRIVATE_TEXT = "fixture-content-not-for-observer";
const RAW_ERROR = "fixture-upstream-message-not-for-observer";
const data = (value) => `data: ${JSON.stringify(value)}\n\n`;
const event = (type, value) => `event: ${type}\n${data({ type, ...value })}`;
const chatChunk = (delta, finish_reason = null) => ({
  id: "chatcmpl-fixture", object: "chat.completion.chunk", created: 1700000000,
  model: MODEL, choices: [{ index: 0, delta, finish_reason }],
});
const CHAT_PART = data(chatChunk({ content: PRIVATE_TEXT }));
const CHAT_END = data({ ...chatChunk({}, "stop"), usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 } });
const CHAT_OK = CHAT_PART + CHAT_END + DONE;
const CHAT_ERROR = data({ error: { type: "upstream_error", status: 429, message: RAW_ERROR } });
const RESPONSE_CREATED = event("response.created", { response: { id: "resp_fixture", created_at: 1700000000 } });
const RESPONSE_ITEM = event("response.output_item.done", {
  output_index: 0, item: { type: "message", role: "assistant", content: [{ type: "output_text", text: PRIVATE_TEXT }] },
});
const RESPONSE_OK = RESPONSE_CREATED + RESPONSE_ITEM + event("response.completed", {
  response: { id: "resp_fixture", status: "completed", usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 } },
});
const CLAUDE_PART = event("content_block_delta", { index: 0, delta: { type: "text_delta", text: PRIVATE_TEXT } });
const CLAUDE_OK = CLAUDE_PART + event("message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 7 } })
  + event("message_stop", {});
const silentLog = { line() {}, errorLine() {}, debug() {}, warn() {}, info() {} };

function upstream(chunks, { keepOpen = false } = {}) {
  let index = 0;
  let pulls = 0;
  let control;
  const cancellations = [];
  const body = new ReadableStream({
    start(controller) { control = controller; },
    pull(controller) {
      pulls++;
      if (index < chunks.length) controller.enqueue(typeof chunks[index] === "string" ? encoder.encode(chunks[index++]) : chunks[index++]);
      else if (!keepOpen) controller.close();
    },
    cancel(reason) { cancellations.push(reason); },
  }, { highWaterMark: 0 });
  return { body, control: () => control, pulls: () => pulls, cancellations };
}

function response(source, contentType = "text/event-stream") {
  return new Response(source.body, { status: 200, headers: { "content-type": contentType, "x-request-id": "fixture-upstream" } });
}

async function collect(body) {
  const bytes = [];
  const reader = body.getReader();
  let error = null;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes.push(...next.value);
    }
  } catch (caught) { error = caught; }
  finally { reader.releaseLock(); }
  return { bytes, text: new TextDecoder().decode(new Uint8Array(bytes)), error };
}

function expectTerminal(calls, outcome, partialResponse, errorClass) {
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ outcome, partialResponse, ...(errorClass ? { errorClass } : {}) });
  expect(Object.keys(calls[0]).every((key) => ["outcome", "partialResponse", "errorClass", "statusCode"].includes(key))).toBe(true);
  if (calls[0].statusCode !== undefined) {
    expect(Number.isInteger(calls[0].statusCode)).toBe(true);
    expect(calls[0].statusCode).toBeGreaterThanOrEqual(100);
    expect(calls[0].statusCode).toBeLessThanOrEqual(599);
  }
  expect(JSON.stringify(calls)).not.toContain(PRIVATE_TEXT);
  expect(JSON.stringify(calls)).not.toContain(RAW_ERROR);
}

async function parsed(wire, format, onStreamTerminal, { mode = "translate", chunks = [wire], sourceFormat = format } = {}) {
  const usage = [];
  const stream = createSSEStream({
    mode, targetFormat: format, sourceFormat, provider: format === FORMATS.GEMINI ? "gemini" : "fixture",
    model: MODEL, body: { messages: [] }, onStreamTerminal,
    onStreamComplete: (...args) => usage.push(args),
  });
  return { ...(await collect(upstream(chunks).body.pipeThrough(stream))), usage };
}

function handlerOptions(source, extra = {}) {
  return {
    providerResponse: response(source), provider: "openai", model: MODEL,
    sourceFormat: FORMATS.OPENAI, targetFormat: FORMATS.OPENAI,
    body: { model: MODEL, messages: [] }, stream: true, requestStartTime: 1700000000000,
    connectionId: "fixture-connection", reqLogger: deps.logger, log: silentLog,
    trackDone() {}, appendLog() {}, ...extra,
  };
}

async function streamed(source, extra = {}) {
  const streamController = createStreamController({ log: silentLog });
  return handleStreamingResponse(handlerOptions(source, { streamController, ...extra }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(1700000000000);
  deps.execute.mockReset();
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("terminal parser complete without changing existing bytes", () => {
  it.each([
    ["OpenAI passthrough", FORMATS.OPENAI, CHAT_OK, "passthrough"],
    ["OpenAI translation", FORMATS.OPENAI, CHAT_OK, "translate"],
    ["Responses", FORMATS.OPENAI_RESPONSES, RESPONSE_OK, "translate"],
    ["Claude passthrough", FORMATS.CLAUDE, CLAUDE_OK, "passthrough"],
    ["Claude translation", FORMATS.CLAUDE, CLAUDE_OK, "translate"],
    ["Gemini", FORMATS.GEMINI, data({ candidates: [{ content: { parts: [{ text: PRIVATE_TEXT }] }, finishReason: "STOP" }] }), "translate"],
    ["Gemini CLI", FORMATS.GEMINI_CLI, data({ response: { candidates: [{ content: { parts: [{ text: PRIVATE_TEXT }] }, finishReason: "STOP" }] } }), "translate"],
    ["Antigravity", FORMATS.ANTIGRAVITY, data({ response: { candidates: [{ content: { parts: [{ text: PRIVATE_TEXT }] }, finishReason: "STOP" }] } }), "translate"],
    ["Vertex", FORMATS.VERTEX, data({ candidates: [{ content: { parts: [{ text: PRIVATE_TEXT }] }, finishReason: "STOP" }] }), "translate"],
    ["Ollama NDJSON", FORMATS.OLLAMA, [
      JSON.stringify({ model: MODEL, message: { role: "assistant", content: PRIVATE_TEXT }, done: false }),
      JSON.stringify({ model: MODEL, done: true, done_reason: "stop", prompt_eval_count: 11, eval_count: 7 }),
    ].join("\n"), "translate"],
  ])("complete %s preserves bytes, finish_reason and usage", async (_name, format, wire, mode) => {
    const calls = [];
    const options = { mode, sourceFormat: format === FORMATS.OLLAMA ? FORMATS.OPENAI : format };
    const baseline = await parsed(wire, format, undefined, options);
    const observed = await parsed(wire, format, (value) => calls.push(value), options);
    expect(baseline.error).toBeNull();
    expect(observed.bytes).toEqual(baseline.bytes);
    expect(observed.error).toBeNull();
    expect(observed.usage).toEqual(baseline.usage);
    expect(observed.text).toContain(PRIVATE_TEXT);
    if (format === FORMATS.OLLAMA) {
      expect(observed.text).toContain('"finish_reason":"stop"');
      expect(observed.text).toContain('"usage":{"prompt_tokens":11,"completion_tokens":7,"total_tokens":18}');
    }
    expectTerminal(calls, "completed", true);
  });

  it("complete sentinel-only stream is not a missing-terminal failure", async () => {
    const calls = [];
    const result = await parsed(DONE, FORMATS.OPENAI, (value) => calls.push(value));
    expect(result.error).toBeNull();
    expectTerminal(calls, "completed", false);
  });

  it("complete OpenAI passthrough retains literal preexisting bytes including its EOF sentinel", async () => {
    const wire = CHAT_PART + DONE;
    for (const observer of [undefined, () => {}]) {
      const result = await parsed(wire, FORMATS.OPENAI, observer, { mode: "passthrough" });
      // Existing passthrough flush adds a sentinel even when the upstream sent one.
      expect(result.bytes).toEqual([...encoder.encode(wire + DONE)]);
    }
  });

  it("complete Responses terminal is observed before EOF and cannot be overwritten by later cancellation", async () => {
    const calls = [];
    const source = upstream([RESPONSE_OK], { keepOpen: true });
    const result = await streamed(source, {
      provider: "codex", sourceFormat: FORMATS.OPENAI_RESPONSES, targetFormat: FORMATS.OPENAI_RESPONSES,
      userAgent: "fixture", onStreamTerminal: (value) => calls.push(value),
    });
    const reader = result.response.body.getReader();
    try {
      let text = "";
      while (!text.includes('"type":"response.completed"')) text += new TextDecoder().decode((await reader.read()).value);
      expectTerminal(calls, "completed", true);
    } finally { await reader.cancel("client closes after response.completed"); }
    expectTerminal(calls, "completed", true);
  });
});

describe("terminal parser failure under HTTP 200", () => {
  it.each([
    ["Claude to OpenAI", FORMATS.CLAUDE, FORMATS.OPENAI, CLAUDE_OK, "completed", true],
    ["Claude error to OpenAI", FORMATS.CLAUDE, FORMATS.OPENAI, CLAUDE_PART + event("error", { error: { message: RAW_ERROR } }), "failed", true],
    ["Responses to OpenAI", FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, RESPONSE_OK, "completed", true],
    ["Responses failed to OpenAI without forwarded text", FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, RESPONSE_CREATED + RESPONSE_ITEM + event("response.failed", { response: { status: "failed" } }), "failed", false],
    ["Responses failed to OpenAI after forwarded text", FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, RESPONSE_CREATED + event("response.output_text.delta", { output_index: 0, content_index: 0, delta: PRIVATE_TEXT }) + RESPONSE_ITEM + event("response.failed", { response: { status: "failed" } }), "failed", true],
    ["OpenAI to Claude", FORMATS.OPENAI, FORMATS.CLAUDE, CHAT_OK, "completed", true],
    ["OpenAI error to Claude", FORMATS.OPENAI, FORMATS.CLAUDE, CHAT_PART + CHAT_ERROR + DONE, "failed", true],
  ])("translation %s observes upstream signals before lossy conversion", async (_name, targetFormat, sourceFormat, wire, outcome, partialResponse) => {
    const calls = [];
    const baseline = await parsed(wire, targetFormat, undefined, { sourceFormat });
    const observed = await parsed(wire, targetFormat, (value) => calls.push(value), { sourceFormat });
    expect(observed).toEqual(baseline);
    if (targetFormat === FORMATS.OPENAI_RESPONSES && sourceFormat === FORMATS.OPENAI && outcome === "failed") {
      if (partialResponse) expect(observed.text).toContain(PRIVATE_TEXT);
      else expect(observed.text).not.toContain(PRIVATE_TEXT);
    }
    expectTerminal(calls, outcome, partialResponse, outcome === "failed" ? "stream_failed" : undefined);
  });

  it.each([
    ["OpenAI passthrough", FORMATS.OPENAI, CHAT_PART + CHAT_ERROR + DONE, "passthrough"],
    ["OpenAI translated", FORMATS.OPENAI, CHAT_PART + CHAT_ERROR + DONE, "translate"],
    ["Responses failed", FORMATS.OPENAI_RESPONSES, RESPONSE_CREATED + RESPONSE_ITEM + event("response.failed", { response: { status: "failed", error: { message: RAW_ERROR } } }) + DONE, "translate"],
    ["Responses incomplete", FORMATS.OPENAI_RESPONSES, RESPONSE_CREATED + RESPONSE_ITEM + event("response.incomplete", { response: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } } }) + DONE, "translate"],
    ["Responses error", FORMATS.OPENAI_RESPONSES, RESPONSE_CREATED + RESPONSE_ITEM + event("error", { error: { message: RAW_ERROR } }) + DONE, "translate"],
    ["Claude error", FORMATS.CLAUDE, CLAUDE_PART + event("error", { error: { type: "overloaded_error", message: RAW_ERROR } }), "translate"],
    ["Claude error passthrough", FORMATS.CLAUDE, CLAUDE_PART + event("error", { error: { type: "overloaded_error", message: RAW_ERROR } }), "passthrough"],
  ])("failure %s is not relabelled complete by sentinel or EOF", async (_name, format, wire, mode) => {
    const calls = [];
    const baseline = await parsed(wire, format, undefined, { mode });
    const observed = await parsed(wire, format, (value) => calls.push(value), { mode });
    expect(observed.bytes).toEqual(baseline.bytes);
    expect(observed.error).toEqual(baseline.error);
    expect(observed.usage).toEqual(baseline.usage);
    expectTerminal(calls, "failed", true, "stream_failed");
  });

  it.each([
    [FORMATS.OPENAI, CHAT_PART, "passthrough"],
    [FORMATS.OPENAI, CHAT_PART, "translate"],
    [FORMATS.OPENAI_RESPONSES, RESPONSE_CREATED + RESPONSE_ITEM, "translate"],
    [FORMATS.CLAUDE, CLAUDE_PART, "translate"],
    [FORMATS.OLLAMA, JSON.stringify({ model: MODEL, message: { role: "assistant", content: PRIVATE_TEXT }, done: false }), "translate"],
  ])("failure premature EOF in %s/%s is not hidden by synthetic terminal output", async (format, wire, mode) => {
    const calls = [];
    const baseline = await parsed(wire, format, undefined, { mode });
    const result = await parsed(wire, format, (value) => calls.push(value), { mode });
    expect(result.bytes).toEqual(baseline.bytes);
    expect(result.error).toEqual(baseline.error);
    expectTerminal(calls, "failed", true, "stream_failed");
  });

  it("failure empty OpenAI EOF is not sentinel-only completion", async () => {
    const calls = [];
    await parsed("", FORMATS.OPENAI, (value) => calls.push(value));
    expectTerminal(calls, "failed", false, "stream_failed");
  });

  it("failure Responses sentinel alone cannot replace response.completed", async () => {
    const calls = [];
    await parsed(DONE, FORMATS.OPENAI_RESPONSES, (value) => calls.push(value));
    expectTerminal(calls, "failed", false, "stream_failed");
  });

  it("failure final unterminated frame uses existing tail parser", async () => {
    const calls = [];
    const wire = CHAT_PART + CHAT_ERROR.trimEnd();
    const baseline = await parsed(wire, FORMATS.OPENAI, undefined);
    const observed = await parsed(wire, FORMATS.OPENAI, (value) => calls.push(value));
    expect(observed.bytes).toEqual(baseline.bytes);
    expectTerminal(calls, "failed", true, "stream_failed");
  });

  it("failure split UTF-8 and split error keys are observed without replay", async () => {
    const calls = [];
    const wire = data(chatChunk({ content: "🙂" })) + CHAT_ERROR + DONE;
    const bytes = encoder.encode(wire);
    const chunks = Array.from(bytes, (byte) => new Uint8Array([byte]));
    const baseline = await parsed(wire, FORMATS.OPENAI, undefined, { mode: "passthrough", chunks });
    const observed = await parsed(wire, FORMATS.OPENAI, (value) => calls.push(value), { mode: "passthrough", chunks });
    expect(observed.bytes).toEqual(baseline.bytes);
    expectTerminal(calls, "failed", true, "stream_failed");
  });

  it("complete user content naming errors is not a protocol failure", async () => {
    const calls = [];
    const wire = data(chatChunk({ content: 'response.failed event: error {"error":true}' })) + CHAT_END + DONE;
    await parsed(wire, FORMATS.OPENAI, (value) => calls.push(value));
    expectTerminal(calls, "completed", true);
  });
});

describe("transport failure, cancellation provenance and no eager buffering", () => {
  it("HTTP success headers and onRequestSuccess are not terminal completion", async () => {
    const calls = [];
    const accepted = [];
    const source = upstream([], { keepOpen: true });
    const result = await streamed(source, { onRequestSuccess: () => accepted.push(true), onStreamTerminal: (value) => calls.push(value) });
    await Promise.resolve();
    expect(result.response.status).toBe(200);
    expect(accepted).toEqual([true]);
    expect(calls).toEqual([]);
    await result.response.body.cancel();
    expectTerminal(calls, "client_cancelled", false);
  });

  it.each(["plain", "socket"])("failure reader rejection after bytes (%s) never retries or replays", async (kind) => {
    async function run(observer) {
      const source = upstream([CHAT_PART], { keepOpen: true });
      const result = await streamed(source, { onStreamTerminal: observer });
      const reader = result.response.body.getReader();
      const first = await reader.read();
      expect(new TextDecoder().decode(first.value)).toBe(CHAT_PART.slice(0, -1));
      const error = Object.assign(new Error(RAW_ERROR), kind === "socket" ? { code: "ECONNRESET" } : {});
      source.control().error(error);
      const tail = [];
      let readError = null;
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          tail.push(...next.value);
        }
      } catch (caught) { readError = caught; }
      finally { reader.releaseLock(); }
      return { bytes: [...first.value, ...tail], readError };
    }
    const baseline = await run(undefined);
    const calls = [];
    const observed = await run((value) => calls.push(value));
    expect(observed.bytes).toEqual(baseline.bytes);
    expect(observed.readError).toEqual(baseline.readError);
    expect(new TextDecoder().decode(new Uint8Array(observed.bytes)).split(PRIVATE_TEXT)).toHaveLength(2);
    expectTerminal(calls, "failed", true, "stream_failed");
  });

  it("failure internal AbortError is not a client cancellation", async () => {
    const calls = [];
    const originalClient = new AbortController();
    const source = upstream([], { keepOpen: true });
    const result = await streamed(source, { requestSignal: originalClient.signal, onStreamTerminal: (value) => calls.push(value) });
    const reading = collect(result.response.body);
    source.control().error(new DOMException(RAW_ERROR, "AbortError"));
    await reading;
    expect(originalClient.signal.aborted).toBe(false);
    expectTerminal(calls, "failed", false, "stream_failed");
  });

  it("failure internal stall timeout stays failed when its abort rejects the reader", async () => {
    const calls = [];
    const originalClient = new AbortController();
    const source = upstream([], { keepOpen: true });
    const controller = createStreamController({ log: silentLog, requestSignal: originalClient.signal, onStreamTerminal: (value) => calls.push(value) });
    controller.signal.addEventListener("abort", () => source.control().error(new DOMException("internal timeout", "AbortError")), { once: true });
    const output = pipeWithDisconnect(response(source), new TransformStream(), controller, null, 10);
    const reading = collect(output);
    await vi.advanceTimersByTimeAsync(11);
    await reading;
    expect(originalClient.signal.aborted).toBe(false);
    expectTerminal(calls, "failed", false, "upstream_timeout");
  });

  it("explicit reader cancellation remains client_cancelled despite a later internal error", async () => {
    const calls = [];
    const source = upstream([CHAT_PART], { keepOpen: true });
    const result = await streamed(source, { onStreamTerminal: (value) => calls.push(value) });
    const reader = result.response.body.getReader();
    await reader.read();
    await reader.cancel(RAW_ERROR);
    await vi.advanceTimersByTimeAsync(501);
    expectTerminal(calls, "client_cancelled", true);
    expect(source.cancellations).toHaveLength(1);
  });

  it("original requestSignal cancellation is explicit even if downstream never cancels", async () => {
    const calls = [];
    const originalClient = new AbortController();
    const controller = createStreamController({ log: silentLog, requestSignal: originalClient.signal, onStreamTerminal: (value) => calls.push(value) });
    originalClient.abort(RAW_ERROR);
    controller.handleError(new DOMException("aborted", "AbortError"));
    expectTerminal(calls, "client_cancelled", false);
  });

  it("complete binary/audio pipe needs no SSE sentinel and preserves arbitrary bytes", async () => {
    const bytes = new Uint8Array([0, 255, 1, 100, 97, 116, 97, 58, 0, 128]);
    const calls = [];
    const controller = createStreamController({ log: silentLog, onStreamTerminal: (value) => calls.push(value) });
    const output = pipeWithDisconnect(response(upstream([bytes]), "audio/mpeg"), new TransformStream(), controller);
    expect((await collect(output)).bytes).toEqual([...bytes]);
    expectTerminal(calls, "completed", true);
  });

  it("failure binary reader rejection retains original error and needs no chunk parser", async () => {
    const calls = [];
    const source = upstream([new Uint8Array([0, 255])], { keepOpen: true });
    const controller = createStreamController({ log: silentLog, onStreamTerminal: (value) => calls.push(value) });
    const output = pipeWithDisconnect(response(source, "audio/mpeg"), new TransformStream(), controller);
    const reader = output.getReader();
    expect([...(await reader.read()).value]).toEqual([0, 255]);
    const originalError = new Error(RAW_ERROR);
    source.control().error(originalError);
    await expect(reader.read()).rejects.toBe(originalError);
    reader.releaseLock();
    expectTerminal(calls, "failed", true, "stream_failed");
  });

  it("observer preserves bounded backpressure instead of draining the entire upstream", async () => {
    async function run(observer) {
      const source = upstream(Array.from({ length: 64 }, () => CHAT_PART), { keepOpen: true });
      const result = await streamed(source, { onStreamTerminal: observer });
      const reader = result.response.body.getReader();
      try {
        const first = await reader.read();
        for (let turn = 0; turn < 20; turn++) await Promise.resolve();
        return { first: [...first.value], pulls: source.pulls() };
      } finally { await reader.cancel(); }
    }
    const baseline = await run(undefined);
    const calls = [];
    const observed = await run((value) => calls.push(value));
    expect(observed).toEqual(baseline);
    expect(observed.pulls).toBeLessThan(64);
    expectTerminal(calls, "client_cancelled", true);
  });

  it("complete streaming observer never tees or requests a second full-body read", async () => {
    const calls = [];
    const source = upstream([CHAT_OK]);
    const input = response(source);
    vi.spyOn(input, "text").mockImplementation(() => { throw new Error("unexpected full-body read"); });
    vi.spyOn(input, "arrayBuffer").mockImplementation(() => { throw new Error("unexpected full-body read"); });
    vi.spyOn(input.body, "tee").mockImplementation(() => { throw new Error("unexpected replay branch"); });
    const result = await streamed(source, { providerResponse: input, onStreamTerminal: (value) => calls.push(value) });
    const output = await collect(result.response.body);
    expect(output.error).toBeNull();
    expect(output.text).toContain(PRIVATE_TEXT);
    expectTerminal(calls, "completed", true);
  });
});

describe("forced SSE-to-JSON terminal observation uses existing conversion", () => {
  const paths = [
    ["forced Chat to Chat", handleForcedSSEToJson, FORMATS.OPENAI, FORMATS.OPENAI, "openai", CHAT_OK],
    ["forced Chat to Responses", handleForcedSSEToJson, FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "openai", CHAT_OK],
    ["forced Chat to Claude", handleForcedSSEToJson, FORMATS.CLAUDE, FORMATS.OPENAI, "openai", CHAT_OK],
    ["forced Responses to Chat", handleForcedSSEToJson, FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, "codex", RESPONSE_OK],
    ["forced Responses to Responses", handleForcedSSEToJson, FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI_RESPONSES, "codex", RESPONSE_OK],
    ["forced Responses to Claude", handleForcedSSEToJson, FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES, "codex", RESPONSE_OK],
    ["forced Responses to Gemini", handleForcedSSEToJson, FORMATS.GEMINI, FORMATS.OPENAI_RESPONSES, "codex", RESPONSE_OK],
    ["forced Responses to Gemini CLI", handleForcedSSEToJson, FORMATS.GEMINI_CLI, FORMATS.OPENAI_RESPONSES, "codex", RESPONSE_OK],
    ["forced Responses to Antigravity", handleForcedSSEToJson, FORMATS.ANTIGRAVITY, FORMATS.OPENAI_RESPONSES, "codex", RESPONSE_OK],
    ["nonStreaming SSE fallback", handleNonStreamingResponse, FORMATS.OPENAI, FORMATS.OPENAI, "openai", CHAT_OK],
  ];

  async function convert(handler, wire, extra = {}) {
    const source = upstream([wire]);
    const result = await handler(handlerOptions(source, { stream: false, ...extra }));
    return {
      success: result.success, status: result.response.status,
      headers: [...result.response.headers], ...(await collect(result.response.body)),
    };
  }

  it.each(paths)("complete %s preserves exact JSON bytes", async (_name, handler, sourceFormat, targetFormat, provider, wire) => {
    const calls = [];
    const options = { sourceFormat, targetFormat, provider };
    const baseline = await convert(handler, wire, options);
    const observed = await convert(handler, wire, { ...options, onStreamTerminal: (value) => calls.push(value) });
    expect(observed).toEqual(baseline);
    expect(observed.success).toBe(true);
    expect(observed.text).toContain(PRIVATE_TEXT);
    expectTerminal(calls, "completed", false);
  });

  it("complete forced Chat JSON also matches the literal preexisting response", async () => {
    const expected = '{"id":"chatcmpl-fixture","object":"chat.completion","created":1700000000,"model":"fixture-model","choices":[{"index":0,"message":{"role":"assistant","content":"fixture-content-not-for-observer"},"finish_reason":"stop"}],"usage":{"prompt_tokens":11,"completion_tokens":7,"total_tokens":18}}';
    for (const onStreamTerminal of [undefined, () => {}]) {
      const result = await convert(handleForcedSSEToJson, CHAT_OK, { onStreamTerminal });
      expect(result.bytes).toEqual([...encoder.encode(expected)]);
    }
  });

  it.each([
    ["forced Chat error", handleForcedSSEToJson, FORMATS.OPENAI, CHAT_PART + CHAT_ERROR + DONE],
    ["forced Chat premature EOF", handleForcedSSEToJson, FORMATS.OPENAI, CHAT_PART],
    ["forced Responses failed", handleForcedSSEToJson, FORMATS.OPENAI_RESPONSES, RESPONSE_CREATED + RESPONSE_ITEM + event("response.failed", { response: { status: "failed", error: { message: RAW_ERROR } } })],
    ["forced Responses incomplete", handleForcedSSEToJson, FORMATS.OPENAI_RESPONSES, RESPONSE_CREATED + RESPONSE_ITEM + event("response.incomplete", { response: { status: "incomplete" } })],
    ["forced Responses premature EOF", handleForcedSSEToJson, FORMATS.OPENAI_RESPONSES, RESPONSE_CREATED + RESPONSE_ITEM],
    ["nonStreaming error", handleNonStreamingResponse, FORMATS.OPENAI, CHAT_PART + CHAT_ERROR + DONE],
    ["nonStreaming premature EOF", handleNonStreamingResponse, FORMATS.OPENAI, CHAT_PART],
  ])("failure %s is observable without changing response or adding a retry", async (_name, handler, targetFormat, wire) => {
    const calls = [];
    const baseline = await convert(handler, wire, { targetFormat });
    const observed = await convert(handler, wire, { targetFormat, onStreamTerminal: (value) => calls.push(value) });
    expect(observed).toEqual(baseline);
    expectTerminal(calls, "failed", false, "stream_failed");
  });

  it.each([handleForcedSSEToJson, handleNonStreamingResponse])("failure reader rejection in JSON conversion is observed", async (handler) => {
    async function run(observer) {
      const source = upstream([CHAT_PART], { keepOpen: true });
      const pending = handler(handlerOptions(source, { stream: false, onStreamTerminal: observer }));
      for (let turn = 0; turn < 10; turn++) await Promise.resolve();
      source.control().error(new Error(RAW_ERROR));
      try {
        const result = await pending;
        return { status: result.response.status, ...(await collect(result.response.body)) };
      } catch (error) { return { rejected: error.message }; }
    }
    const baseline = await run(undefined);
    const calls = [];
    expect(await run((value) => calls.push(value))).toEqual(baseline);
    expectTerminal(calls, "failed", false, "stream_failed");
  });

  it("complete Responses conversion without content-type follows provider format", async () => {
    const calls = [];
    const source = upstream([RESPONSE_OK]);
    const result = await handleForcedSSEToJson(handlerOptions(source, {
      provider: "codex", targetFormat: FORMATS.OPENAI_RESPONSES, stream: false,
      providerResponse: response(source, ""), onStreamTerminal: (value) => calls.push(value),
    }));
    expect(result.success).toBe(true);
    expect((await result.response.json()).choices[0].message.content).toBe(PRIVATE_TEXT);
    expectTerminal(calls, "completed", false);
  });

  it("non-SSE input is declined without consuming or finalizing it", async () => {
    const calls = [];
    const source = upstream(['{"choices":[]}']);
    const input = response(source, "application/json");
    const result = await handleForcedSSEToJson(handlerOptions(source, {
      providerResponse: input, onStreamTerminal: (value) => calls.push(value),
    }));
    expect(result).toBeNull();
    expect(input.bodyUsed).toBe(false);
    expect(calls).toEqual([]);
  });

  it.each(["client", "internal"])("failure forced JSON abort distinguishes %s provenance", async (origin) => {
    const calls = [];
    const client = new AbortController();
    const source = upstream([], { keepOpen: true });
    const pending = handleForcedSSEToJson(handlerOptions(source, {
      stream: false, requestSignal: client.signal, onStreamTerminal: (value) => calls.push(value),
    }));
    if (origin === "client") client.abort();
    source.control().error(new DOMException("fixture aborted", "AbortError"));
    const result = await pending;
    await collect(result.response.body);
    expectTerminal(calls, origin === "client" ? "client_cancelled" : "failed", false, origin === "internal" ? "stream_failed" : undefined);
  });
});

describe("callback isolation and app-owned root finalization", () => {
  it.each(["throw", "reject"])("failure observer %s cannot replace the original reader error", async (kind) => {
    const calls = [];
    const source = upstream([], { keepOpen: true });
    const controller = createStreamController({
      log: silentLog,
      onStreamTerminal(value) {
        calls.push(value);
        if (kind === "throw") throw new Error("observer only");
        return Promise.reject(new Error("observer only"));
      },
    });
    const output = pipeWithDisconnect(response(source), new TransformStream(), controller);
    const reading = collect(output);
    const original = new Error(RAW_ERROR);
    source.control().error(original);
    expect((await reading).error).toBe(original);
    expectTerminal(calls, "failed", false, "stream_failed");
  });

  it.each(["throw", "reject", "pending"])("complete observer %s cannot alter stream bytes or usage", async (kind) => {
    const unhandled = [];
    const onUnhandled = (reason) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    const calls = [];
    const observer = (value) => {
      calls.push(value);
      if (kind === "throw") throw new Error("observer only");
      if (kind === "reject") return Promise.reject(new Error("observer only"));
      return new Promise(() => {});
    };
    try {
      const baseline = await parsed(CHAT_OK, FORMATS.OPENAI, undefined, { mode: "passthrough" });
      const observed = await parsed(CHAT_OK, FORMATS.OPENAI, observer, { mode: "passthrough" });
      expect(observed).toEqual(baseline);
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
      expectTerminal(calls, "completed", true);
    } finally { process.off("unhandledRejection", onUnhandled); }
  });

  it.each([handleForcedSSEToJson, handleNonStreamingResponse])("complete JSON observer rejection does not replace the response", async (handler) => {
    const calls = [];
    const run = async (onStreamTerminal) => {
      const result = await handler(handlerOptions(upstream([CHAT_OK]), { stream: false, onStreamTerminal }));
      return { status: result.response.status, ...(await collect(result.response.body)) };
    };
    const baseline = await run(undefined);
    const observed = await run((value) => { calls.push(value); return Promise.reject(new Error("observer only")); });
    expect(observed).toEqual(baseline);
    expectTerminal(calls, "completed", false);
  });

  it("failure callback can finalize captured root after return without replacing dispatcher sink", async () => {
    const calls = [];
    let finalize;
    let source;
    const result = await runWithWebhookContext({ requestId: "fixture-request", modality: "chat" }, async () => {
      markWebhookAdmitted();
      finalize = captureWebhookFinalizer();
      source = upstream([CHAT_PART], { keepOpen: true });
      const output = await streamed(source, { onStreamTerminal: (value) => { calls.push(value); finalize(value); } });
      expect(getWebhookContext().finalized).toBe(false);
      return output;
    });
    const reader = result.response.body.getReader();
    await reader.read();
    source.control().error(new Error(RAW_ERROR));
    try { while (!(await reader.read()).done) {} } finally { reader.releaseLock(); }
    expectTerminal(calls, "failed", true, "stream_failed");
    expect(finalize({ outcome: "failed", errorClass: "stream_failed" }).reason).toBe("duplicate");
  });
});

describe("chatCore forwards the optional observer without new fallback", () => {
  function args(extra = {}) {
    return {
      body: { model: "gpt-4o-mini", stream: true, messages: [{ role: "user", content: "fixture" }] },
      modelInfo: { provider: "openai", model: "gpt-4o-mini" },
      credentials: { accessToken: "fixture-token", connectionId: "fixture-connection", providerSpecificData: {} },
      sourceFormatOverride: FORMATS.OPENAI, clientRawRequest: { headers: {}, body: {} }, log: silentLog,
      ...extra,
    };
  }

  it("failure after partial chatCore output executes upstream once and preserves bytes", async () => {
    const source = upstream([CHAT_PART], { keepOpen: true });
    deps.execute.mockResolvedValue({ response: response(source), headers: {}, url: "https://fixture.invalid/chat" });
    const calls = [];
    const result = await handleChatCore(args({ onStreamTerminal: (value) => calls.push(value) }));
    const reader = result.response.body.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe(CHAT_PART.slice(0, -1));
    source.control().error(new Error(RAW_ERROR));
    const tail = [];
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        tail.push(...next.value);
      }
    } finally { reader.releaseLock(); }
    expect(deps.execute).toHaveBeenCalledTimes(1);
    expect(new TextDecoder().decode(new Uint8Array([...first.value, ...tail])).split(PRIVATE_TEXT)).toHaveLength(2);
    expectTerminal(calls, "failed", true, "stream_failed");
  });

  it("complete chatCore stream threads callback through shared context", async () => {
    deps.execute.mockImplementation(async () => ({ response: response(upstream([CHAT_OK])), headers: {}, url: "https://fixture.invalid/chat" }));
    const calls = [];
    const result = await handleChatCore(args({ onStreamTerminal: (value) => calls.push(value) }));
    expect(result.response.status).toBe(200);
    await collect(result.response.body);
    expectTerminal(calls, "completed", true);
  });

  it("complete chatCore Responses stream:false threads forced JSON callback", async () => {
    deps.execute.mockResolvedValue({ response: response(upstream([RESPONSE_OK])), responseFormat: FORMATS.OPENAI_RESPONSES, headers: {}, url: "https://fixture.invalid/responses" });
    const calls = [];
    const result = await handleChatCore(args({
      body: { model: "gpt-4o-mini", stream: false, messages: [{ role: "user", content: "fixture" }] },
      onStreamTerminal: (value) => calls.push(value),
    }));
    expect((await result.response.json()).choices[0].message.content).toBe(PRIVATE_TEXT);
    expectTerminal(calls, "completed", false);
  });

  it("failure chatCore stream:false unexpected SSE threads nonStreaming observer", async () => {
    deps.execute.mockResolvedValue({ response: response(upstream([CHAT_PART + CHAT_ERROR + DONE])), headers: {}, url: "https://fixture.invalid/chat" });
    const calls = [];
    const result = await handleChatCore(args({
      body: { model: "gpt-4o-mini", stream: false, messages: [{ role: "user", content: "fixture" }] },
      onStreamTerminal: (value) => calls.push(value),
    }));
    await collect(result.response.body);
    expect(deps.execute).toHaveBeenCalledTimes(1);
    expectTerminal(calls, "failed", false, "stream_failed");
  });

  it("chatCore preserves original requestSignal instead of treating every AbortError as client cancel", async () => {
    const calls = [];
    const client = new AbortController();
    const source = upstream([], { keepOpen: true });
    deps.execute.mockImplementation(async ({ signal }) => {
      signal.addEventListener("abort", () => source.control().error(new DOMException("fixture aborted", "AbortError")), { once: true });
      return { response: response(source), headers: {}, url: "https://fixture.invalid/chat" };
    });
    const result = await handleChatCore(args({ requestSignal: client.signal, onStreamTerminal: (value) => calls.push(value) }));
    const reading = collect(result.response.body);
    client.abort();
    await vi.advanceTimersByTimeAsync(501);
    // Closing the fixture bounds RED even before requestSignal is wired in GREEN.
    source.control().error(new DOMException("fixture cleanup", "AbortError"));
    await reading;
    expectTerminal(calls, "client_cancelled", false);
  });
});
