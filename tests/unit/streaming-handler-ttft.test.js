import { beforeEach, describe, expect, it, vi } from "vitest";

const saveRequestDetailMock = vi.fn(() => Promise.resolve());
const saveUsageStatsMock = vi.fn();
const ttftMock = vi.fn();

vi.mock("@/lib/usageDb.js", () => ({
  saveRequestDetail: (...args) => saveRequestDetailMock(...args),
}));

vi.mock("../../src/sse/utils/logger.js", () => ({
  ttft: (...args) => ttftMock(...args),
}));

vi.mock("../../open-sse/handlers/chatCore/requestDetail.js", async () => {
  const actual = await vi.importActual(
    "../../open-sse/handlers/chatCore/requestDetail.js",
  );
  return {
    ...actual,
    saveUsageStats: (...args) => saveUsageStatsMock(...args),
  };
});

function createProviderResponse(chunks = ["data: hello\n\n"]) {
  return {
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      },
    }),
  };
}

describe("streamingHandler TTFT path", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  it("defers placeholder request detail persistence until after response construction", async () => {
    const { handleStreamingResponse } =
      await import("../../open-sse/handlers/chatCore/streamingHandler.js");

    const result = handleStreamingResponse({
      providerResponse: createProviderResponse(),
      provider: "codex",
      model: "gpt-5.5",
      sourceFormat: "openai",
      targetFormat: "openai",
      userAgent: "claude-code",
      body: { model: "cx/gpt-5.5", messages: [], stream: true },
      stream: true,
      translatedBody: { model: "gpt-5.5" },
      finalBody: { model: "gpt-5.5" },
      requestStartTime: Date.now() - 25,
      connectionId: "conn-1",
      apiKey: "sk-test",
      clientRawRequest: { endpoint: "/v1/chat/completions", headers: {} },
      onRequestSuccess: vi.fn(),
      reqLogger: {
        appendProviderChunk: vi.fn(),
        appendConvertedChunk: vi.fn(),
      },
      toolNameMap: null,
      streamController: {
        signal: undefined,
        startTime: Date.now(),
        isConnected: () => true,
        handleComplete: vi.fn(),
        handleError: vi.fn(),
        handleDisconnect: vi.fn(),
        abort: vi.fn(),
      },
      onStreamComplete: vi.fn(),
      credentials: {},
      midStreamResumeEnabled: false,
      timing: { requestParsedAt: Date.now() - 20 },
    });

    expect(result.success).toBe(true);
    expect(result.response).toBeInstanceOf(Response);
    expect(saveRequestDetailMock).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();
    expect(saveRequestDetailMock).toHaveBeenCalledTimes(1);
  });

  it("reuses the same request-detail id on stream completion", async () => {
    const { buildOnStreamComplete } =
      await import("../../open-sse/handlers/chatCore/streamingHandler.js");

    const requestStartTime = Date.now() - 100;
    const timing = {
      requestParsedAt: requestStartTime + 5,
      requestReadyAt: requestStartTime + 20,
      upstreamFetchStartedAt: requestStartTime + 30,
      upstreamFirstByteAt: requestStartTime + 50,
      clientFirstChunkAt: requestStartTime + 60,
    };

    const { onStreamComplete } = buildOnStreamComplete({
      provider: "codex",
      model: "gpt-5.5",
      connectionId: "conn-1",
      apiKey: "sk-test",
      requestStartTime,
      body: { model: "cx/gpt-5.5", messages: [], stream: true },
      stream: true,
      finalBody: { model: "gpt-5.5" },
      translatedBody: { model: "gpt-5.5" },
      clientRawRequest: { endpoint: "/v1/chat/completions" },
      timing,
    });

    onStreamComplete(
      { content: "hello", thinking: null },
      { prompt_tokens: 1, completion_tokens: 2 },
      requestStartTime + 60,
      "detail-123",
    );

    expect(saveRequestDetailMock).toHaveBeenCalledTimes(1);
    expect(saveRequestDetailMock.mock.calls[0][0].id).toBe("detail-123");
    expect(saveUsageStatsMock).toHaveBeenCalledTimes(1);
    expect(ttftMock).toHaveBeenCalledTimes(1);
    expect(ttftMock.mock.calls[0][1]).toMatchObject({
      ttft: 60,
      parse: 5,
      authModel: 20,
      upstreamStart: 30,
      upstreamFirstByte: 50,
      clientFirstChunk: 60,
    });
  });
});
