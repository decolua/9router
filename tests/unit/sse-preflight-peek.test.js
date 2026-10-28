import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: () => { },
  appendRequestLog: async () => { },
  saveRequestDetail: async () => { },
  saveRequestUsage: async () => { },
}));

import { parseFirstSseError, peekSseErrorFrame } from "../../open-sse/utils/streamHelpers.js";
import { detectErrorBody } from "../../open-sse/utils/error.js";
import { handleStreamingResponse } from "../../open-sse/handlers/chatCore/streamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { withPreContentRetry } from "../../open-sse/utils/preContentRetry.js";

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
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

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
      providerResponse: withPreContentRetry(sse(failure), { attempts: 1, delayMs: 0, reexecute }),
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

  it("does not peek non-compatible providers", async () => {
    const result = await handleStreamingResponse({
      ...base,
      provider: "ollama",
      streamController: makeController(),
      providerResponse: sse('data: {"message":"The service is temporarily overloaded.","type":"upstream_error"}\n\n'),
    });

    expect(result.success).toBe(true);
  });
});
