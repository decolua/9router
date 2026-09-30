import { beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

const db = vi.hoisted(() => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));
vi.mock("@/lib/usageDb.js", () => db);

import { FORMATS, GEMINI_STREAM_FORMATS } from "../../open-sse/translator/formats.js";
import { initState, translateResponse } from "../../open-sse/translator/index.js";
import { createSSEStream } from "../../open-sse/utils/stream.js";
import { createStreamController } from "../../open-sse/utils/streamHandler.js";
import { buildOnStreamComplete, handleStreamingResponse } from "../../open-sse/handlers/chatCore/streamingHandler.js";

const encoder = new TextEncoder();
const usage = { promptTokenCount: 23, candidatesTokenCount: 4, totalTokenCount: 27 };
const candidate = (parts = [], finishReason, index = 0) => ({
  responseId: "fixture-response", modelVersion: "gemini-fixture",
  candidates: [{ index, content: { role: "model", parts }, ...(finishReason ? { finishReason } : {}) }],
});
const text = value => candidate([{ text: value }]);
const tool = () => candidate([{ functionCall: { id: "tool-fixture", name: "read", args: { file_path: "private-tool-argument" } } }]);
const block = () => ({ promptFeedback: { blockReason: "SAFETY" }, usageMetadata: usage });
const parse = value => value.split(/\r?\n/).filter(line => line.startsWith("data: ") && line !== "data: [DONE]").map(line => JSON.parse(line.slice(6)));
const input = (frames, wrapped = true, suffix = "\n\n") => frames.map(frame => frame === "[DONE]"
  ? "data: [DONE]" : `data: ${JSON.stringify(wrapped ? { response: frame } : frame)}`).join("\n\n") + suffix;

async function run(frames, { targetFormat = FORMATS.ANTIGRAVITY, sourceFormat = FORMATS.CLAUDE, wrapped = true, suffix = "\n\n", splitBytes = false } = {}) {
  const onStreamComplete = vi.fn();
  const bytes = encoder.encode(input(frames, wrapped, suffix));
  const readable = new ReadableStream({ start(controller) {
    if (splitBytes) for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    else controller.enqueue(bytes);
    controller.close();
  } });
  const output = await new Response(readable.pipeThrough(createSSEStream({
    targetFormat, sourceFormat, provider: "antigravity", model: "gemini-fixture", onStreamComplete,
  }))).text();
  return { output, events: parse(output), onStreamComplete, outcome: onStreamComplete.mock.calls[0]?.[3] };
}

beforeEach(() => vi.clearAllMocks());

describe.each([...GEMINI_STREAM_FORMATS])("%s terminal integrity", targetFormat => {
  it.each([false, true])("maps explicit no-candidate prompt blocking to one refusal (wrapped=%s)", async wrapped => {
    const result = await run([block(), block(), "[DONE]"], { targetFormat, wrapped });
    expect(result.events.filter(e => e.type === "message_start")).toHaveLength(1);
    expect(result.events.filter(e => e.type === "message_stop")).toHaveLength(1);
    expect(result.events.find(e => e.type === "message_delta").delta.stop_reason).toBe("refusal");
    expect(result.events.some(e => e.type === "error")).toBe(false);
    expect(result.outcome).toMatchObject({ status: "error", code: "content_filter" });
    expect(result.onStreamComplete).toHaveBeenCalledTimes(1);
  });

  it("preserves ordinary text and closes once despite duplicate finish and metadata trailers", async () => {
    const result = await run([text("你好"), candidate([], "STOP"), candidate([], "STOP"), { usageMetadata: usage }, text("must not reopen")], { targetFormat });
    expect(result.events.filter(e => e.type === "message_stop")).toHaveLength(1);
    expect(result.output).not.toContain("must not reopen");
    expect(result.output).toContain("你好");
    expect(result.onStreamComplete.mock.calls[0][1]).toMatchObject({ prompt_tokens: 23, completion_tokens: 4 });
    expect(result.outcome).toEqual({ status: "success" });
  });
});

describe("Gemini incomplete and failed streams", () => {
  it.each([
    ["empty", []],
    ["metadata only", [{ usageMetadata: usage }]],
    ["text", [text("partial")]],
    ["thinking", [candidate([{ text: "partial thinking", thought: true }])]],
    ["signature only", [candidate([{ thoughtSignature: "fixture-signature" }])]],
    ["tools", [tool()]],
    ["sentinel without finish", [text("partial"), "[DONE]"]],
    ["secondary candidate finish", [text("partial"), candidate([], "STOP", 1)]],
    ["unspecified prompt block", [{ promptFeedback: { blockReason: "BLOCK_REASON_UNSPECIFIED" } }]],
    ["ratings without block", [{ promptFeedback: { safetyRatings: [{ probability: "LOW" }] } }]],
    ["unspecified finish", [candidate([], "FINISH_REASON_UNSPECIFIED")]],
  ])("reports %s EOF as one explicit error, not a successful finish", async (_label, frames) => {
    const result = await run(frames);
    expect(result.events.filter(e => e.type === "error")).toHaveLength(1);
    expect(result.events.at(-1).error).toMatchObject({ type: "api_error", code: "incomplete_upstream_stream" });
    expect(result.events.some(e => e.type === "message_stop")).toBe(false);
    expect(result.events.some(e => e.delta?.type === "input_json_delta")).toBe(false);
    expect(result.output).not.toContain("private-tool-argument");
    expect(result.outcome.status).toBe("error");
    expect(result.onStreamComplete).toHaveBeenCalledTimes(1);
    expect(db.appendRequestLog).not.toHaveBeenCalledWith(expect.objectContaining({ status: "200 OK" }));
    expect(db.trackPendingRequest).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("surfaces an in-band error before candidate validation (wrapped=%s)", async wrapped => {
    const result = await run([tool(), { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "private-credential-do-not-echo" } }, candidate([], "STOP")], { wrapped });
    expect(result.events.filter(e => e.type === "error")).toHaveLength(1);
    expect(result.events.at(-1).error).toMatchObject({ type: "rate_limit_error", code: "upstream_stream_error" });
    expect(result.output).not.toContain("private-credential-do-not-echo");
    expect(result.output).not.toContain("private-tool-argument");
    expect(result.events.some(e => e.type === "message_stop")).toBe(false);
  });

  it("honors an outer error even with an inner candidate", async () => {
    const result = await run([{ error: { code: 403 }, response: text("must not forward") }], { wrapped: false });
    expect(result.events).toHaveLength(1);
    expect(result.events[0].error.type).toBe("permission_error");
    expect(result.output).not.toContain("must not forward");
  });

  it("preserves outer prompt feedback even when an inner response has no candidates", async () => {
    const result = await run([{ promptFeedback: { blockReason: "SAFETY" }, response: { candidates: [] } }], { wrapped: false });
    expect(result.events.find(e => e.type === "message_delta").delta.stop_reason).toBe("refusal");
  });

  it.each(["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT"])("keeps %s refusal but discards buffered tool arguments", async reason => {
    const result = await run([tool(), candidate([], reason)]);
    expect(result.events.find(e => e.type === "message_delta").delta.stop_reason).toBe("refusal");
    expect(result.events.filter(e => e.type === "message_stop")).toHaveLength(1);
    expect(result.output).not.toContain("private-tool-argument");
    expect(result.events.some(e => e.delta?.type === "input_json_delta")).toBe(false);
  });

  it("keeps valid tool arguments and tool_use termination", async () => {
    const result = await run([tool(), candidate([], "STOP")]);
    expect(result.events.find(e => e.type === "message_delta").delta.stop_reason).toBe("tool_use");
    expect(result.events.find(e => e.delta?.type === "input_json_delta").index).toBe(0);
    expect(result.output).toContain("private-tool-argument");
  });

  it("preserves MAX_TOKENS without misclassifying it as a truncated transport", async () => {
    const result = await run([text("partial"), candidate([], "MAX_TOKENS")]);
    expect(result.events.find(e => e.type === "message_delta").delta.stop_reason).toBe("max_tokens");
    expect(result.outcome.status).toBe("success");
  });

  it("does not classify a refusal sentence by its natural-language contents", async () => {
    const sentence = "This request was blocked by Gemini's filters.";
    const healthy = await run([text(sentence), candidate([], "STOP")]);
    expect(healthy.outcome.status).toBe("success");
    const truncated = await run([text(sentence)]);
    expect(truncated.outcome.code).toBe("incomplete_upstream_stream");
  });

  it.each([block(), { error: { code: 500 } }, candidate([], "STOP")])("handles a terminal in an unterminated final SSE line", async terminal => {
    const result = await run([text("你好"), terminal], { suffix: "", splitBytes: true });
    expect(result.events.at(-1).type).toMatch(/^(message_stop|error)$/);
    expect(result.events.filter(e => ["message_stop", "error"].includes(e.type))).toHaveLength(1);
    expect(result.output).toContain("你好");
  });

  it("is idempotent at the translator's repeated null flush", () => {
    const state = initState(FORMATS.CLAUDE);
    translateResponse(FORMATS.ANTIGRAVITY, FORMATS.CLAUDE, { response: text("partial") }, state);
    translateResponse(FORMATS.ANTIGRAVITY, FORMATS.CLAUDE, null, state);
    const outcome = state.geminiStreamOutcome;
    translateResponse(FORMATS.ANTIGRAVITY, FORMATS.CLAUDE, null, state);
    expect(state.geminiStreamOutcome).toBe(outcome);
  });

  it("emits an OpenAI error before DONE for Chat Completions clients", async () => {
    const result = await run([text("partial")], { sourceFormat: FORMATS.OPENAI });
    expect(result.events.at(-1).error.code).toBe("incomplete_upstream_stream");
    expect(result.output).toMatch(/data: \[DONE\]\n\n$/);
    expect(result.events.some(e => e.choices?.[0]?.finish_reason)).toBe(false);
  });

  it.each([[text("partial")], [block()]].map(frames => [frames]))("emits response.failed rather than response.completed for Responses clients", async frames => {
    const result = await run(frames, { sourceFormat: FORMATS.OPENAI_RESPONSES });
    expect(result.events.at(-1).type).toBe("response.failed");
    expect(result.events.some(e => e.type === "response.completed")).toBe(false);
  });
});

async function handlerFor(readable) {
  const success = vi.fn();
  const log = { line: vi.fn(), errorLine: vi.fn() };
  const options = {
    provider: "antigravity", model: "gemini-fixture", sourceFormat: FORMATS.CLAUDE,
    targetFormat: FORMATS.ANTIGRAVITY, body: { messages: [], model: "gemini-fixture" },
    stream: true, requestStartTime: Date.now() - 100, onRequestSuccess: success, log,
  };
  const completion = buildOnStreamComplete(options);
  const result = await handleStreamingResponse({
    ...options, ...completion,
    streamController: createStreamController({ provider: options.provider, model: options.model, log }),
    providerResponse: new Response(readable, { headers: { "Content-Type": "text/event-stream" } }),
  });
  return { ...result, success, log };
}

describe("Gemini real pipe and completion accounting (mocked DB, no network)", () => {
  it.each([[block()], [text("partial")], [{ error: { code: 429 } }]].map(frames => [frames]))("does not log success or reset account failures for failed streams", async frames => {
    const readable = new ReadableStream({ start(controller) {
      controller.enqueue(encoder.encode(input([...frames.map(frame => ({ ...frame, usageMetadata: usage }))])));
      controller.close();
    } });
    const result = await handlerFor(readable);
    await result.response.text();
    expect(result.success).not.toHaveBeenCalled();
    const detail = db.saveRequestDetail.mock.calls.at(-1)[0];
    expect(detail.status).toBe("error");
    expect(detail.response.error.code).toBeTruthy();
    expect(db.saveRequestUsage).toHaveBeenCalledWith(expect.objectContaining({ status: "error", tokens: expect.objectContaining({ prompt_tokens: 23 }) }));
    expect(result.log.line).not.toHaveBeenCalled();
    expect(result.log.errorLine).toHaveBeenCalledTimes(1);
  });

  it("resets account failures only after semantic success", async () => {
    const result = await handlerFor(new ReadableStream({ start(controller) {
      controller.enqueue(encoder.encode(input([text("ok"), { ...candidate([], "STOP"), usageMetadata: usage }])));
      controller.close();
    } }));
    await result.response.text();
    expect(result.success).toHaveBeenCalledTimes(1);
    expect(db.saveRequestDetail.mock.calls.at(-1)[0].status).toBe("success");
  });

  it.each([candidate([], "STOP"), block(), { error: { code: 429 } }])("does not append a second terminal after a post-terminal socket reset", async terminal => {
    let upstream;
    const result = await handlerFor(new ReadableStream({ start(controller) {
      upstream = controller;
      controller.enqueue(encoder.encode(input([text("ok"), terminal])));
    } }));
    const reader = result.response.body.getReader();
    let output = "";
    while (!/event: (message_stop|error)\n/.test(output)) {
      const { value, done } = await reader.read();
      expect(done).toBe(false);
      output += new TextDecoder().decode(value);
    }
    upstream.error(new Error("socket hang up"));
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      output += new TextDecoder().decode(value);
    }
    const terminals = parse(output).filter(e => ["message_stop", "error"].includes(e.type));
    expect(terminals).toHaveLength(1);
    expect(db.saveRequestDetail.mock.calls.at(-1)[0].status).toBe(terminal.candidates ? "success" : "error");
  });
});
