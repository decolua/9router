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
const { createStreamController } = await import("../../open-sse/utils/streamHandler.js");

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

  it("does not run success side effects when cancel wins a flush race", async () => {
    const onRequestSuccess = vi.fn();
    const { onStreamComplete, onStreamError } = buildOnStreamComplete(completionContext(onRequestSuccess));

    expect(onStreamError).toBeTypeOf("function");
    onStreamError(new DOMException("cancelled", "AbortError"));
    onStreamComplete(
      { content: "late" },
      { prompt_tokens: 3, completion_tokens: 1 },
      Date.now(),
      { terminalSuccess: true },
    );
    await Promise.resolve();

    expect(onRequestSuccess).not.toHaveBeenCalled();
    expect(usageDbMocks.saveRequestUsage).not.toHaveBeenCalled();
    expect(usageDbMocks.saveRequestDetail).toHaveBeenCalledTimes(1);
    expect(usageDbMocks.saveRequestDetail).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error" }),
    );
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
});
