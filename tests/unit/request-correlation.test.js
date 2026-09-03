import { beforeEach, describe, expect, it, vi } from "vitest";

const { saveRequestDetailMock } = vi.hoisted(() => ({
  saveRequestDetailMock: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: saveRequestDetailMock,
  saveRequestUsage: vi.fn(() => Promise.resolve()),
}));

import { FORMATS } from "../../open-sse/translator/formats.js";
import { handleNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { handleForcedSSEToJson } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";
import { buildRequestDetail } from "../../open-sse/handlers/chatCore/requestDetail.js";
import { buildOnStreamComplete, handleStreamingResponse } from "../../open-sse/handlers/chatCore/streamingHandler.js";

const CORRELATION_ID = "019f7fa1-0d8d-7000-8000-000000000000";
const REQUEST_ID = "019f7fa1-0d8d-7000-8000-000000000001";

beforeEach(() => saveRequestDetailMock.mockClear());

describe("request correlation", () => {
  it("preserves request id in request detail records", () => {
    const detail = buildRequestDetail({
      id: REQUEST_ID,
      attemptId: REQUEST_ID,
      correlationId: CORRELATION_ID,
      provider: "codex",
      model: "gpt-5.6-sol",
    });

    expect(detail).toMatchObject({
      id: REQUEST_ID,
      attemptId: REQUEST_ID,
      correlationId: CORRELATION_ID,
    });
  });

  it("uses request id for streaming detail updates", () => {
    const result = buildOnStreamComplete({
      requestId: REQUEST_ID,
      correlationId: CORRELATION_ID,
      provider: "codex",
      model: "gpt-5.6-sol",
      requestStartTime: Date.now(),
      body: {},
      translatedBody: {},
    });

    expect(result.streamDetailId).toBe(REQUEST_ID);
  });

  it("uses request id for streaming completion persistence", () => {
    const { onStreamComplete } = buildOnStreamComplete({
      requestId: REQUEST_ID,
      correlationId: CORRELATION_ID,
      provider: "codex",
      model: "gpt-5.6-sol",
      requestStartTime: Date.now(),
      body: {},
      translatedBody: {},
    });

    onStreamComplete({ content: "OK" }, { input_tokens: 1, output_tokens: 1 }, Date.now());

    expect(saveRequestDetailMock).toHaveBeenCalledTimes(1);
    expect(saveRequestDetailMock.mock.calls[0][0]).toMatchObject({
      id: REQUEST_ID,
      attemptId: REQUEST_ID,
      correlationId: CORRELATION_ID,
    });
  });

  it("uses request id for non-streaming persistence", async () => {
    await handleNonStreamingResponse({
      requestId: REQUEST_ID,
      correlationId: CORRELATION_ID,
      providerResponse: new Response(JSON.stringify({
        id: "chatcmpl-test",
        model: "test-model",
        choices: [{ message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }), { headers: { "content-type": "application/json" } }),
      provider: "github",
      model: "test-model",
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI,
      body: { messages: [] },
      stream: false,
      translatedBody: {},
      requestStartTime: Date.now(),
      clientRawRequest: { endpoint: "/v1/chat/completions" },
      reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
      trackDone: vi.fn(),
      appendLog: vi.fn(),
    });

    expect(saveRequestDetailMock).toHaveBeenCalledTimes(1);
    expect(saveRequestDetailMock.mock.calls[0][0]).toMatchObject({
      id: REQUEST_ID,
      attemptId: REQUEST_ID,
      correlationId: CORRELATION_ID,
    });
  });

  it("uses request id for forced SSE-to-JSON persistence", async () => {
    const chunk = {
      id: "chatcmpl-test",
      model: "test-model",
      choices: [{ delta: { content: "OK" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    };
    await handleForcedSSEToJson({
      requestId: REQUEST_ID,
      correlationId: CORRELATION_ID,
      providerResponse: new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
        headers: { "content-type": "text/event-stream" },
      }),
      sourceFormat: FORMATS.OPENAI,
      provider: "github",
      model: "test-model",
      body: { messages: [] },
      stream: true,
      translatedBody: {},
      requestStartTime: Date.now(),
      clientRawRequest: { endpoint: "/v1/chat/completions" },
      trackDone: vi.fn(),
      appendLog: vi.fn(),
    });

    expect(saveRequestDetailMock).toHaveBeenCalledTimes(1);
    expect(saveRequestDetailMock.mock.calls[0][0]).toMatchObject({
      id: REQUEST_ID,
      attemptId: REQUEST_ID,
      correlationId: CORRELATION_ID,
    });
  });

  it("uses request id for streaming in-progress persistence", async () => {
    await handleStreamingResponse({
      providerResponse: new Response("data: [DONE]\n\n", {
        headers: { "content-type": "text/event-stream" },
      }),
      provider: "github",
      model: "test-model",
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI,
      userAgent: "test",
      body: { messages: [] },
      stream: true,
      translatedBody: {},
      requestStartTime: Date.now(),
      connectionId: "test-connection",
      reqLogger: {},
      streamController: { signal: undefined, handleError: vi.fn() },
      onStreamComplete: vi.fn(),
      streamDetailId: REQUEST_ID,
      correlationId: CORRELATION_ID,
    });

    expect(saveRequestDetailMock).toHaveBeenCalledTimes(1);
    expect(saveRequestDetailMock.mock.calls[0][0]).toMatchObject({
      id: REQUEST_ID,
      attemptId: REQUEST_ID,
      correlationId: CORRELATION_ID,
    });
  });
});
