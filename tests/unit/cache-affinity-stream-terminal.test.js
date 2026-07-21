import { beforeEach, describe, expect, it, vi } from "vitest";

const usageDbMocks = vi.hoisted(() => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(),
}));

vi.mock("@/lib/usageDb.js", () => usageDbMocks);

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const {
  createPassthroughStreamWithLogger,
  createSSETransformStreamWithLogger,
} = await import("../../open-sse/utils/stream.js");
const {
  buildOnStreamComplete,
} = await import("../../open-sse/handlers/chatCore/streamingHandler.js");
const {
  handleForcedSSEToJson,
} = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");
const {
  createDisconnectAwareStream,
  createStreamController,
} = await import("../../open-sse/utils/streamHandler.js");

function completionContext(onRequestSuccess = vi.fn()) {
  return {
    provider: "codex",
    model: "gpt-5.6-sol",
    connectionId: "account-a",
    apiKey: "sk-test",
    requestStartTime: Date.now(),
    body: { input: [] },
    stream: true,
    clientRawRequest: { endpoint: "/v1/responses" },
    onRequestSuccess,
    log: { line: vi.fn() },
  };
}

async function drain(transform, input) {
  return new Response(new Response(input).body.pipeThrough(transform)).text();
}

beforeEach(() => vi.clearAllMocks());

describe("stream terminal success", () => {
  it("forwards AbortError to terminal error handling", () => {
    const onError = vi.fn();
    const controller = createStreamController({ onError });

    controller.handleError(new DOMException("aborted", "AbortError"));

    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("records incomplete Responses EOF as error without usage or success side effects", async () => {
    const onRequestSuccess = vi.fn();
    const { onStreamComplete } = buildOnStreamComplete(completionContext(onRequestSuccess));

    onStreamComplete(
      { content: "partial" },
      { prompt_tokens: 3, completion_tokens: 1 },
      Date.now(),
      { terminalSuccess: false },
    );
    await Promise.resolve();

    expect(onRequestSuccess).not.toHaveBeenCalled();
    expect(usageDbMocks.saveRequestUsage).not.toHaveBeenCalled();
    expect(usageDbMocks.saveRequestDetail).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error" }),
    );
  });

  it("does not run success side effects when cancel precedes an incomplete flush", async () => {
    const onRequestSuccess = vi.fn();
    const { onStreamComplete, onStreamError } = buildOnStreamComplete(completionContext(onRequestSuccess));

    expect(onStreamError).toBeTypeOf("function");
    onStreamError(new DOMException("cancelled", "AbortError"));
    onStreamComplete(
      { content: "late" },
      { prompt_tokens: 3, completion_tokens: 1 },
      Date.now(),
      { terminalSuccess: false },
    );
    await Promise.resolve();

    expect(onRequestSuccess).not.toHaveBeenCalled();
    expect(usageDbMocks.saveRequestUsage).not.toHaveBeenCalled();
    expect(usageDbMocks.saveRequestDetail).toHaveBeenCalledTimes(1);
    expect(usageDbMocks.saveRequestDetail).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error" }),
    );
  });

  it("lets an explicit successful terminal override an earlier client cancel", async () => {
    const onRequestSuccess = vi.fn();
    const { onStreamComplete, onStreamError } = buildOnStreamComplete(completionContext(onRequestSuccess));

    onStreamError(new DOMException("cancelled", "AbortError"));
    onStreamComplete(
      { content: "complete" },
      { prompt_tokens: 3, completion_tokens: 1 },
      Date.now(),
      { terminalSuccess: true },
    );
    await Promise.resolve();

    expect(onRequestSuccess).toHaveBeenCalledTimes(1);
    expect(usageDbMocks.saveRequestUsage).toHaveBeenCalledTimes(1);
    expect(usageDbMocks.saveRequestDetail).toHaveBeenCalledTimes(2);
    expect(usageDbMocks.saveRequestDetail).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "success" }),
    );
  });

  it("finalizes a parsed terminal when the client cancels before transform flush", async () => {
    const onStreamComplete = vi.fn();
    const onDisconnect = vi.fn();
    const transform = createPassthroughStreamWithLogger(
      "github", null, "claude-fable-5", "account-a", {}, onStreamComplete,
    );
    const encoder = new TextEncoder();
    const upstream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}\n\n'));
      },
    });
    const streamController = createStreamController({ onDisconnect });
    const output = createDisconnectAwareStream(
      {
        readable: upstream.pipeThrough(transform),
        writable: { getWriter: () => ({ abort: () => Promise.resolve() }) },
      },
      streamController,
      null,
      transform.terminalState,
    );
    const reader = output.getReader();

    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain('"finish_reason":"stop"');
    await reader.cancel("client_closed");
    await Promise.resolve();

    expect(onStreamComplete).toHaveBeenCalledTimes(1);
    expect(onStreamComplete).toHaveBeenCalledWith(
      expect.any(Object),
      expect.anything(),
      expect.any(Number),
      { terminalSuccess: true },
    );
    expect(onDisconnect).not.toHaveBeenCalled();
  });

  it("reports successful and failed Responses terminals accurately", async () => {
    const metadata = [];
    const callback = (_content, _usage, _ttftAt, terminal) => metadata.push(terminal);
    const incomplete = createSSETransformStreamWithLogger(
      FORMATS.OPENAI_RESPONSES,
      FORMATS.OPENAI_RESPONSES,
      "codex",
      null,
      null,
      "gpt-5.6-sol",
      "account-a",
      { input: [] },
      callback,
    );
    const completed = createSSETransformStreamWithLogger(
      FORMATS.OPENAI_RESPONSES,
      FORMATS.OPENAI_RESPONSES,
      "codex",
      null,
      null,
      "gpt-5.6-sol",
      "account-a",
      { input: [] },
      callback,
    );

    const failedOutput = await drain(incomplete, [
      "event: response.output_text.delta",
      'data: {"type":"response.output_text.delta","delta":"partial"}',
      "",
    ].join("\n"));
    await drain(completed, [
      "event: response.completed",
      'data: {"type":"response.completed","response":{"status":"completed","output":[]}}',
      "",
      "data: [DONE]",
      "",
      "",
    ].join("\n"));

    expect(failedOutput).toContain("response.failed");
    expect(metadata).toEqual([
      { terminalSuccess: false },
      { terminalSuccess: true },
    ]);
  });

  it("requires an explicit terminal signal in passthrough mode", async () => {
    const metadata = [];
    const callback = (_content, _usage, _ttftAt, terminal) => metadata.push(terminal);
    const incomplete = createPassthroughStreamWithLogger(
      "github", null, "claude-fable-5", "account-a", {}, callback,
    );
    const completed = createPassthroughStreamWithLogger(
      "github", null, "claude-fable-5", "account-a", {}, callback,
    );

    await drain(incomplete, 'data: {"choices":[{"delta":{"content":"partial"},"finish_reason":null}]}\n\n');
    await drain(completed, [
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      "",
      "data: [DONE]",
      "",
      "",
    ].join("\n"));

    expect(metadata).toEqual([
      { terminalSuccess: false },
      { terminalSuccess: true },
    ]);
  });

  it("emits response.failed when a Responses passthrough stream closes without a terminal", async () => {
    const metadata = [];
    const incomplete = createPassthroughStreamWithLogger(
      "codex",
      null,
      "gpt-5.6-sol",
      "account-a",
      { input: [] },
      (_content, _usage, _ttftAt, terminal) => metadata.push(terminal),
    );

    const output = await drain(incomplete, [
      "event: response.output_text.delta",
      'data: {"type":"response.output_text.delta","delta":"partial"}',
      "",
    ].join("\n"));

    expect(output).toContain("event: response.failed");
    expect(output.indexOf("event: response.failed")).toBeLessThan(output.indexOf("data: [DONE]"));
    expect(output.match(/data: \[DONE\]/g)).toHaveLength(1);
    expect(metadata).toEqual([{ terminalSuccess: false }]);
  });

  it("parses trailing passthrough terminals and rejects cancelled reasons", async () => {
    const metadata = [];
    const callback = (_content, _usage, _ttftAt, terminal) => metadata.push(terminal);
    const trailing = createPassthroughStreamWithLogger(
      "github", null, "claude-fable-5", "account-a", {}, callback,
    );
    const cancelled = createPassthroughStreamWithLogger(
      "github", null, "claude-fable-5", "account-a", {}, callback,
    );

    await drain(trailing, 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}');
    await drain(cancelled, 'data: {"choices":[{"delta":{},"finish_reason":"cancelled"}]}\n\n');

    expect(metadata).toEqual([
      { terminalSuccess: true },
      { terminalSuccess: false },
    ]);
  });

  it("recognizes Claude, Gemini, and Antigravity successful terminal events", async () => {
    const metadata = [];
    const callback = (_content, _usage, _ttftAt, terminal) => metadata.push(terminal);
    const claude = createPassthroughStreamWithLogger(
      "github", null, "claude-fable-5", "account-a", {}, callback,
    );
    const gemini = createPassthroughStreamWithLogger(
      "gemini", null, "gemini-2.5-pro", "account-b", {}, callback,
    );
    const antigravity = createPassthroughStreamWithLogger(
      "antigravity", null, "gemini-2.5-pro", "account-c", {}, callback,
    );

    await drain(claude, 'data: {"type":"message_stop"}\n\n');
    await drain(gemini, 'data: {"candidates":[{"finishReason":"STOP"}]}\n\n');
    await drain(antigravity, 'data: {"response":{"candidates":[{"finishReason":"STOP"}]}}\n\n');

    expect(metadata).toEqual([
      { terminalSuccess: true },
      { terminalSuccess: true },
      { terminalSuccess: true },
    ]);
  });

  it("rejects failed or unterminated forced Responses streams and accepts incomplete terminals", async () => {
    const onRequestSuccess = vi.fn();
    const base = {
      sourceFormat: FORMATS.OPENAI_RESPONSES,
      provider: "codex",
      model: "gpt-5.6-sol",
      body: { input: [] },
      stream: true,
      requestStartTime: Date.now(),
      connectionId: "account-a",
      apiKey: "sk-test",
      clientRawRequest: { endpoint: "/v1/responses" },
      onRequestSuccess,
      trackDone: vi.fn(),
      appendLog: vi.fn(),
      log: { line: vi.fn() },
    };
    const failed = await handleForcedSSEToJson({
      ...base,
      providerResponse: new Response([
        "event: response.failed",
        'data: {"type":"response.failed","response":{"status":"failed"}}',
        "",
        "",
      ].join("\n"), { headers: { "content-type": "text/event-stream" } }),
    });
    const unterminated = await handleForcedSSEToJson({
      ...base,
      providerResponse: new Response([
        "event: response.output_text.delta",
        'data: {"type":"response.output_text.delta","delta":"partial"}',
        "",
        "",
      ].join("\n"), { headers: { "content-type": "text/event-stream" } }),
    });
    const incomplete = await handleForcedSSEToJson({
      ...base,
      providerResponse: new Response([
        "event: response.incomplete",
        'data: {"type":"response.incomplete","response":{"status":"incomplete","output":[],"usage":{"input_tokens":2,"output_tokens":1,"total_tokens":3}}}',
        "",
        "",
      ].join("\n"), { headers: { "content-type": "text/event-stream" } }),
    });

    expect(failed.success).toBe(false);
    expect(unterminated.success).toBe(false);
    expect(incomplete.success).toBe(true);
    expect(onRequestSuccess).toHaveBeenCalledTimes(1);
    expect(usageDbMocks.saveRequestUsage).toHaveBeenCalledTimes(1);
  });
});
