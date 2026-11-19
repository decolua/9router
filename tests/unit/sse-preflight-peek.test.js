import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: () => { },
  appendRequestLog: async () => { },
  saveRequestDetail: vi.fn(async () => { }),
  saveRequestUsage: async () => { },
}));

import { parseFirstSseError, peekSseErrorFrame } from "../../open-sse/utils/streamHelpers.js";
import { detectErrorBody } from "../../open-sse/utils/error.js";
vi.mock("../../open-sse/config/runtimeConfig.js", async (load) => ({
  ...await load(),
  STREAM_PRECONTENT_RETRY_ATTEMPTS: 1,
  STREAM_PRECONTENT_RETRY_DELAY_MS: 0,
  STREAM_HEARTBEAT_INTERVAL_MS: 25,
  STREAM_TERMINAL_GRACE_MS: 100,
  resolveStreamStallTimeoutMs: () => 50,
}));

import { buildOnStreamComplete, handleStreamingResponse } from "../../open-sse/handlers/chatCore/streamingHandler.js";
import { createStreamController } from "../../open-sse/utils/streamHandler.js";
import { saveRequestDetail } from "@/lib/usageDb.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const encoder = new TextEncoder();

function makeController() {
  let connected = true;
  return {
    signal: new AbortController().signal,
    startTime: Date.now(),
    isConnected: () => connected,
    handleComplete: () => { connected = false; },
    handleError: () => { connected = false; },
    handleDisconnect: () => { connected = false; },
    abort: () => { connected = false; },
  };
}

async function readAll(body) {
  const reader = body.getReader();
  try { return await readThrough(reader); }
  finally { reader.releaseLock(); }
}

async function readThrough(reader, marker) {
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    if (marker && text.includes(marker) && text.endsWith("\n\n")) return text;
  }
  if (marker) throw new Error(`Stream ended before ${marker}`);
  return text + decoder.decode();
}

const data = (payload) => `data: ${JSON.stringify(payload)}\n\n`;
const event = (payload) => `event: ${payload.type}\n${data(payload)}`;
const partial = data({ choices: [{ index: 0, delta: { content: "partial answer" } }] });
const length = data({ choices: [{ index: 0, delta: {}, finish_reason: "length" }] });
const done = "data: [DONE]\n\n";

describe("detectErrorBody with numeric codes", () => {
  it("detects the reported flat { message, code } error shape", () => {
    expect(detectErrorBody({ message: "Upstream request failed", code: 502 }))
      .toMatchObject({ message: "Upstream request failed" });
  });
});

describe("parseFirstSseError", () => {
  it("detects flat, nested and Responses-failure first events", () => {
    expect(parseFirstSseError('data: {"message":"The service is temporarily overloaded.","code":502}\n\n'))
      .toMatchObject({ message: "The service is temporarily overloaded." });
    expect(parseFirstSseError('data: {"error":{"message":"boom","type":"upstream_error"}}\n\n'))
      .toMatchObject({ message: "boom" });
    expect(parseFirstSseError('data: {"type":"response.failed","response":{"error":{"code":"x","message":"failed"}}}\n\n'))
      .toMatchObject({ message: "failed" });
  });

  it("ignores normal chunks, [DONE] and non-JSON lines", () => {
    expect(parseFirstSseError('data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n')).toBeNull();
    expect(parseFirstSseError("data: [DONE]\n\n")).toBeNull();
    expect(parseFirstSseError(": ping\n\n")).toBeNull();
  });
});

describe("peekSseErrorFrame", () => {
  it("returns the error and cancels the body when the first event is an error", async () => {
    let cancelled = false;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"message":"Upstream request failed","code":502}\n\n'));
      },
      cancel() { cancelled = true; },
    });

    const peeked = await peekSseErrorFrame(new Response(stream), 1000);

    expect(peeked.error).toMatchObject({ message: "Upstream request failed" });
    expect(peeked.response).toBeNull();
    expect(cancelled).toBe(true);
  });

  it("replays every byte of a healthy stream", async () => {
    const input = 'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n'
      + 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'
      + "data: [DONE]\n\n";

    const peeked = await peekSseErrorFrame(new Response(encoder.encode(input)), 1000);

    expect(peeked.error).toBeNull();
    expect(await readAll(peeked.response.body)).toBe(input);
  });

  it("bounds the wait and still streams late data", async () => {
    const stream = new ReadableStream({
      async start(controller) {
        await new Promise((resolve) => setTimeout(resolve, 30));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"late"}}]}\n\n'));
        controller.close();
      },
    });

    const started = Date.now();
    const peeked = await peekSseErrorFrame(new Response(stream), 20);
    const elapsed = Date.now() - started;

    expect(peeked.error).toBeNull();
    expect(elapsed).toBeGreaterThanOrEqual(15);
    expect(elapsed).toBeLessThan(500);
    expect(await readAll(peeked.response.body)).toContain('"late"');
  });

  it("is a no-op when the timeout is disabled", async () => {
    const response = new Response(encoder.encode("data: x\n\n"));

    const peeked = await peekSseErrorFrame(response, 0);

    expect(peeked.response).toBe(response);
  });
});

describe("handleStreamingResponse pre-flight peek", () => {
  const base = {
    provider: "openai-compatible-chat-test",
    model: "gpt-5.6-sol",
    sourceFormat: FORMATS.OPENAI,
    targetFormat: FORMATS.OPENAI,
    userAgent: "",
    body: { messages: [] },
    stream: true,
    translatedBody: null,
    finalBody: null,
    requestStartTime: Date.now(),
    connectionId: null,
    apiKey: null,
    clientRawRequest: null,
    onRequestSuccess: null,
    reqLogger: null,
    toolNameMap: null,
    customToolNames: null,
    streamController: makeController(),
    onStreamComplete: null,
    streamDetailId: undefined,
    pxpipe: null,
    reqTag: null,
    log: null,
    credentials: null,
  };

  const sse = (text) => new Response(encoder.encode(text), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });

  it("turns an error-first SSE body into a retryable 502 before any bytes flow", async () => {
    const onRequestSuccess = vi.fn();
    const result = await handleStreamingResponse({
      ...base,
      onRequestSuccess,
      streamController: makeController(),
      providerResponse: sse('data: {"message":"The service is temporarily overloaded.","type":"upstream_error"}\n\n'),
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(result.accountStatus).toBe(502);
    expect(await result.response.text()).toContain("The service is temporarily overloaded.");
    expect(onRequestSuccess).not.toHaveBeenCalled();
  });

  it("streams a healthy SSE body unchanged", async () => {
    const onRequestSuccess = vi.fn();
    const result = await handleStreamingResponse({
      ...base,
      onRequestSuccess,
      streamController: makeController(),
      providerResponse: sse('data: {"choices":[{"delta":{"role":"assistant","content":"hi"}}]}\n\ndata: [DONE]\n\n'),
    });

    expect(result.success).toBe(true);
    expect(await readAll(result.response.body)).toContain('"content":"hi"');
    expect(onRequestSuccess).toHaveBeenCalledOnce();
  });

  it.each([
    ["text/html", "<title>Upstream failed</title>"],
    ["application/json", JSON.stringify({ error: { message: "Upstream failed" } })],
  ])("does not mark rejected %s responses healthy", async (contentType, body) => {
    const onRequestSuccess = vi.fn();
    const result = await handleStreamingResponse({
      ...base,
      onRequestSuccess,
      streamController: makeController(),
      providerResponse: new Response(body, { headers: { "content-type": contentType } }),
    });

    expect(result.success).toBe(false);
    expect(await result.response.text()).toContain("Upstream failed");
    expect(onRequestSuccess).not.toHaveBeenCalled();
  });

  it("waits for pending SSE preflight before marking the account healthy", async () => {
    let upstream;
    const onRequestSuccess = vi.fn();
    const pending = handleStreamingResponse({
      ...base,
      onRequestSuccess,
      streamController: makeController(),
      providerResponse: new Response(new ReadableStream({
        start(controller) { upstream = controller; },
      }), { headers: { "content-type": "text/event-stream" } }),
    });

    await Promise.resolve();
    const callsBeforeAcceptance = onRequestSuccess.mock.calls.length;
    upstream.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n'));
    upstream.close();
    const result = await pending;

    expect(await result.response.text()).toContain('"content":"hi"');
    expect(callsBeforeAcceptance).toBe(0);
    expect(onRequestSuccess).toHaveBeenCalledOnce();
  });

  it.each([false, true])("marks healthy only when pre-content retry recovers: %s", async (recovers) => {
    const failure = 'data: {"error":{"message":"temporarily overloaded","code":503}}\n\n';
    const healthy = 'data: {"choices":[{"delta":{"content":"recovered"}}]}\n\ndata: [DONE]\n\n';
    const onRequestSuccess = vi.fn();
    let callsDuringRetry;
    const reexecute = vi.fn(async () => {
      callsDuringRetry = onRequestSuccess.mock.calls.length;
      return sse(recovers ? healthy : failure);
    });
    const result = await handleStreamingResponse({
      ...base,
      onRequestSuccess,
      streamController: makeController(),
      providerResponse: sse(failure),
      reexecute,
    });

    expect(await result.response.text()).toContain(recovers ? "recovered" : "temporarily overloaded");
    expect(reexecute).toHaveBeenCalledOnce();
    expect(callsDuringRetry).toBe(0);
    expect(result.success).toBe(recovers);
    expect(onRequestSuccess).toHaveBeenCalledTimes(recovers ? 1 : 0);
  });

  it("keeps tool names and IDs restored after successful preflight", async () => {
    const onRequestSuccess = vi.fn();
    const result = await handleStreamingResponse({
      ...base,
      onRequestSuccess,
      toolNameMap: new Map([["read_client", "read"]]),
      streamController: makeController(),
      providerResponse: sse('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"read_client","arguments":"{}"}}]}}]}\n\ndata: [DONE]\n\n'),
    });

    const text = await result.response.text();
    const chunk = JSON.parse(text.split("\n").find((line) => line.startsWith("data: ")).slice(6));
    const toolCall = chunk.choices[0].delta.tool_calls[0];
    expect(toolCall.function.name).toBe("read");
    expect(toolCall.id).toEqual(expect.any(String));
    expect(toolCall.id.length).toBeGreaterThan(0);
    expect(onRequestSuccess).toHaveBeenCalledOnce();
  });

  it("does not run generic retries on native streams", async () => {
    const reexecute = vi.fn();
    const result = await handleStreamingResponse({
      ...base,
      provider: "ollama",
      reexecute,
      streamController: makeController(),
      providerResponse: sse('data: {"message":"The service is temporarily overloaded.","type":"upstream_error"}\n\n'),
    });

    expect(result.success).toBe(true);
    expect(await result.response.text()).toContain("temporarily overloaded");
    expect(reexecute).not.toHaveBeenCalled();
  });

  it("exposes an exhausted in-band 524 as 502 with the original account status", async () => {
    const failure = data({ error: { message: "Upstream timed out", status: 524 } });
    const reexecute = vi.fn(async () => sse(failure));
    const result = await handleStreamingResponse({
      ...base, streamController: makeController(), providerResponse: sse(failure), reexecute,
    });
    expect(result).toMatchObject({ success: false, status: 502, accountStatus: 524 });
    expect(await result.response.json()).toMatchObject({ error: { message: "[502]: Upstream timed out" } });
    expect(reexecute).toHaveBeenCalledOnce();
  });

  it("logs actual usage separately from the finish reason and request limit", async () => {
    const log = { line: vi.fn() };
    const getProviderBody = () => ({ max_completion_tokens: 65536 });
    const callbacks = buildOnStreamComplete({ ...base, log, getProviderBody, getAttemptCount: () => 2 });
    const result = await handleStreamingResponse({
      ...base, ...callbacks, log, getProviderBody, streamController: makeController(),
      providerResponse: sse(partial + length + data({
        choices: [], usage: { prompt_tokens: 100, completion_tokens: 32000, completion_tokens_details: { reasoning_tokens: 1200 } },
      }) + done),
    });
    expect(await result.response.text()).toContain('"finish_reason":"length"');
    const line = log.line.mock.lastCall[2];
    expect(line).toContain("OUT 32000");
    expect(line).toContain("REASONING 1200");
    expect(line).toContain("FINISH length");
    expect(line).toContain("max_completion_tokens=65536");
    expect(line).not.toContain("USAGE estimated");
    expect(saveRequestDetail).toHaveBeenLastCalledWith(expect.objectContaining({
      id: callbacks.streamDetailId, status: "success", streamTelemetry: expect.objectContaining({
        attemptCount: 2, finishReason: "length", terminalEventType: "chat.finish_reason", usageEstimated: false,
      }),
    }));
  });

  describe("stream termination", () => {
    async function open(initial, options = {}) {
      let upstream;
      const cancel = vi.fn();
      const body = new ReadableStream({ start(controller) { upstream = controller; }, cancel });
      upstream.enqueue(encoder.encode(initial));
      const client = new AbortController();
      const onComplete = vi.fn();
      const onError = vi.fn();
      const onDisconnect = vi.fn();
      const streamController = createStreamController({
        onComplete, onError, onDisconnect, signal: client.signal, log: { line: vi.fn(), errorLine: vi.fn() },
      });
      const onRequestSuccess = vi.fn();
      const onStreamFailure = vi.fn();
      const reexecute = vi.fn();
      const result = await handleStreamingResponse({
        ...base, ...options, streamController, reexecute, onRequestSuccess, onStreamFailure,
        providerResponse: new Response(body, { headers: { "Content-Type": "text/event-stream" } }),
      });
      expect(result.success).toBe(true);
      const reader = result.response.body.getReader();
      return { body, upstream, reader, cancel, client, reexecute, onRequestSuccess, onStreamFailure, onComplete, onError, onDisconnect };
    }

    it.each(["reset", "network envelope", "EOF"])("emits one failure after visible output followed by %s", async (failure) => {
      const ctx = await open(partial);
      const head = await readThrough(ctx.reader, "partial answer");
      if (failure === "reset") ctx.upstream.error(new TypeError("terminated", { cause: { code: "ECONNRESET" } }));
      else if (failure === "network envelope") {
        ctx.upstream.enqueue(encoder.encode(data({
          name: "APIError",
          data: {
            message: "Network connection failed", isRetryable: true,
            metadata: { code: "", syscall: "", message: "network connection was lost" },
          },
        }) + done));
      } else ctx.upstream.close();
      const text = head + await readThrough(ctx.reader);
      ctx.reader.releaseLock();
      expect(text.match(/partial answer/g)).toHaveLength(1);
      expect(text.match(/"error":/g)).toHaveLength(1);
      expect(text.match(/data: \[DONE\]/g)).toHaveLength(1);
      expect(text).toContain('"code":502');
      expect(ctx.reexecute).not.toHaveBeenCalled();
      expect(ctx.onError).toHaveBeenCalledOnce();
      expect(ctx.onStreamFailure).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ phase: "committed", usageEstimated: true }));
      expect(ctx.onRequestSuccess).not.toHaveBeenCalled();
      expect(ctx.body.locked).toBe(false);
    });

    it("enforces the upstream stall deadline even while downstream heartbeats flow", async () => {
      vi.useFakeTimers();
      let ctx;
      try {
        ctx = await open(partial);
        await readThrough(ctx.reader, "partial answer");
        const heartbeat = ctx.reader.read();
        await vi.advanceTimersByTimeAsync(25);
        expect(new TextDecoder().decode((await heartbeat).value)).toBe(": keepalive\n\n");
        const terminal = readThrough(ctx.reader);
        await vi.advanceTimersByTimeAsync(25);
        expect(await terminal).toContain('"message":"stream stall timeout","code":504');
        expect(ctx.cancel).toHaveBeenCalledOnce();
        expect(ctx.onStreamFailure).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        await ctx?.reader.cancel();
        ctx?.reader.releaseLock();
        vi.useRealTimers();
      }
    });

    it("keeps a genuine length finish if the socket resets during terminal grace", async () => {
      const ctx = await open(partial + length, { sourceFormat: FORMATS.OPENAI_RESPONSES });
      const head = await readThrough(ctx.reader, "partial answer");
      ctx.upstream.error(new TypeError("terminated"));
      const text = head + await readThrough(ctx.reader);
      ctx.reader.releaseLock();
      expect(text.match(/event: response.incomplete/g)).toHaveLength(1);
      expect(text).toContain('"reason":"max_output_tokens"');
      expect(text).not.toContain("event: response.failed");
      expect(ctx.onRequestSuccess).toHaveBeenCalledOnce();
      expect(ctx.onStreamFailure).not.toHaveBeenCalled();
    });

    it("honors a longer terminal grace after the shorter stall interval elapses", async () => {
      vi.useFakeTimers();
      let ctx;
      try {
        ctx = await open(partial + length, { sourceFormat: FORMATS.OPENAI_RESPONSES });
        const terminal = readThrough(ctx.reader);
        await vi.advanceTimersByTimeAsync(75);
        expect(ctx.cancel).not.toHaveBeenCalled();
        ctx.upstream.enqueue(encoder.encode(data({ choices: [], usage: { prompt_tokens: 123, completion_tokens: 7 } }) + done));
        const text = await terminal;
        expect(text.match(/event: response.incomplete/g)).toHaveLength(1);
        expect(text).toContain('"output_tokens":7');
        expect(text).not.toContain("stream stall timeout");
        expect(ctx.onComplete).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        await ctx?.reader.cancel();
        ctx?.reader.releaseLock();
        vi.useRealTimers();
      }
    });

    it.each([true, false])("requires Claude message_stop before finishing Responses (%s)", async (receivedStop) => {
      const frames = event({ type: "message_start", message: { id: "msg_test", role: "assistant", usage: { input_tokens: 10 } } })
        + event({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "partial answer" } })
        + event({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } })
        + (receivedStop ? event({ type: "message_stop" }) : "");
      const ctx = await open(frames, { sourceFormat: FORMATS.OPENAI_RESPONSES, targetFormat: FORMATS.CLAUDE });
      ctx.upstream.close();
      const text = await readThrough(ctx.reader);
      ctx.reader.releaseLock();
      expect(text).toContain("partial answer");
      expect(text).toContain(receivedStop ? "event: response.completed" : "event: response.failed");
      expect(text).not.toContain(receivedStop ? "event: response.failed" : "event: response.completed");
      expect(ctx.onRequestSuccess).toHaveBeenCalledTimes(receivedStop ? 1 : 0);
    });
  });
});
