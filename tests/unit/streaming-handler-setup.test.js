import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createPassthrough: vi.fn(() => { throw new Error("transform construction failed"); }),
  onResilienceEvent: vi.fn(),
  handleError: vi.fn(),
  cancel: vi.fn(async () => {}),
  buildRequestDetail: vi.fn((detail) => detail),
  abort: vi.fn(),
}));

vi.mock("../../open-sse/translator/index.js", () => ({ needsTranslation: vi.fn(() => false) }));
vi.mock("../../open-sse/utils/stream.js", () => ({
  createSSETransformStreamWithLogger: vi.fn(),
  createPassthroughStreamWithLogger: mocks.createPassthrough,
}));
vi.mock("../../open-sse/handlers/chatCore/requestDetail.js", () => ({
  buildRequestDetail: mocks.buildRequestDetail,
  extractRequestConfig: vi.fn(() => ({})),
  saveUsageStats: vi.fn(),
  formatDoneLine: vi.fn(),
}));
vi.mock("@/lib/usageDb.js", () => ({ saveRequestDetail: vi.fn(async () => {}) }));

const { handleStreamingResponse } = await import("../../open-sse/handlers/chatCore/streamingHandler.js");
const { FORMATS } = await import("../../open-sse/translator/formats.js");

describe("S2-E streaming setup abandonment", () => {
  it("cancels the partial upstream body before handoff when transform setup throws", async () => {
    const result = await handleStreamingResponse({
      providerResponse: {
        status: 200,
        headers: new Headers({ "content-type": "text/event-stream" }),
        body: { cancel: mocks.cancel },
      },
      provider: "groq", model: "test", sourceFormat: FORMATS.OPENAI, targetFormat: FORMATS.OPENAI,
      body: { stream: true }, stream: true, requestStartTime: Date.now(), connectionId: "connection-a",
      onResilienceEvent: mocks.onResilienceEvent, streamController: { handleError: mocks.handleError },
    });

    expect(result.success).toBe(false);
    expect(result.response.status).toBe(502);
    expect(mocks.cancel).toHaveBeenCalledOnce();
    expect(mocks.onResilienceEvent).toHaveBeenCalledWith("STREAM_FAILED", expect.objectContaining({ origin: "processing" }));
    expect(mocks.handleError).toHaveBeenCalledOnce();
  });

  it("cancels the locked upstream body when request-detail setup throws after pipe ownership", async () => {
    mocks.cancel.mockClear();
    mocks.onResilienceEvent.mockClear();
    mocks.handleError.mockClear();
    mocks.abort.mockClear();
    mocks.createPassthrough.mockImplementationOnce(() => new TransformStream());
    mocks.buildRequestDetail.mockImplementationOnce(() => { throw new Error("detail setup failed"); });
    let upstreamCancelled = 0;
    const upstream = new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode("data: {}\n\n")); },
      cancel() { upstreamCancelled++; },
    });
    const result = await handleStreamingResponse({
      providerResponse: { status: 200, headers: new Headers({ "content-type": "text/event-stream" }), body: upstream },
      provider: "groq", model: "test", sourceFormat: FORMATS.OPENAI, targetFormat: FORMATS.OPENAI,
      body: { stream: true }, stream: true, requestStartTime: Date.now(), connectionId: "connection-after-pipe",
      onResilienceEvent: mocks.onResilienceEvent,
      streamController: { isConnected: () => true, handleError: mocks.handleError, abort: mocks.abort },
    });

    expect(result).toMatchObject({ success: false });
    expect(result.response.status).toBe(502);
    await Promise.resolve();
    expect(upstreamCancelled).toBe(1);
    expect(mocks.abort).toHaveBeenCalledOnce();
    expect(mocks.onResilienceEvent).toHaveBeenCalledWith("STREAM_FAILED", expect.objectContaining({ origin: "processing" }));
    expect(mocks.handleError).toHaveBeenCalledOnce();
  });
});
