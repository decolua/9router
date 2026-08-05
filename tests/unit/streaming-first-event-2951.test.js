import { beforeEach, describe, expect, it, vi } from "vitest";

const { saveRequestDetail } = vi.hoisted(() => ({ saveRequestDetail: vi.fn(() => Promise.resolve()) }));

vi.mock("../../open-sse/utils/stream.js", () => ({
  createSSETransformStreamWithLogger: vi.fn(() => new TransformStream()),
  createPassthroughStreamWithLogger: vi.fn(() => new TransformStream()),
}));
vi.mock("../../open-sse/utils/streamHandler.js", () => ({
  pipeWithDisconnect: vi.fn((response, transform) => response.body.pipeThrough(transform)),
}));
vi.mock("../../open-sse/handlers/chatCore/requestDetail.js", () => ({
  buildRequestDetail: vi.fn((detail) => detail),
  extractRequestConfig: vi.fn(() => ({})),
  saveUsageStats: vi.fn(),
  formatDoneLine: vi.fn(() => ""),
}));
vi.mock("@/lib/usageDb.js", () => ({ saveRequestDetail }));

import { buildOnStreamComplete, handleStreamingResponse } from "../../open-sse/handlers/chatCore/streamingHandler.js";

const options = (body, onRequestSuccess = vi.fn()) => ({
  providerResponse: new Response(body, { headers: { "content-type": "text/event-stream" } }),
  provider: "nvidia",
  model: "test-model",
  sourceFormat: "openai",
  targetFormat: "openai",
  body: {},
  stream: true,
  requestStartTime: Date.now(),
  onRequestSuccess,
  streamController: { handleError: vi.fn() },
});

describe("streaming first-event gate (#2951)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects an empty stream without recording success", async () => {
    const onRequestSuccess = vi.fn();
    const result = await handleStreamingResponse(options("", onRequestSuccess));

    expect(result.success).toBe(false);
    expect(result.response.status).toBe(502);
    expect(onRequestSuccess).not.toHaveBeenCalled();
  });

  it("records success after the first semantic SSE event", async () => {
    const onRequestSuccess = vi.fn();
    const chunk = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n';
    const result = await handleStreamingResponse(options(chunk, onRequestSuccess));

    expect(result.success).toBe(true);
    expect(onRequestSuccess).toHaveBeenCalledOnce();
    expect(await result.response.text()).toBe(chunk);
  });

  it("accepts semantic NDJSON used by SSE-compatible providers", async () => {
    const chunk = '{"choices":[{"delta":{"content":"hi"}}]}\n';
    const result = await handleStreamingResponse(options(chunk));

    expect(result.success).toBe(true);
    expect(await result.response.text()).toBe(chunk);
  });

  it("rejects a response.failed event before recording success", async () => {
    const onRequestSuccess = vi.fn();
    const chunk = 'data: {"type":"response.failed","response":{"error":{"message":"nope"}}}\n\n';
    const result = await handleStreamingResponse(options(chunk, onRequestSuccess));

    expect(result).toMatchObject({ success: false, status: 502, scope: "stream" });
    expect(onRequestSuccess).not.toHaveBeenCalled();
  });

  it("stores first-valid streams as streaming, not success", async () => {
    const chunk = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n';
    await handleStreamingResponse(options(chunk));

    expect(saveRequestDetail).toHaveBeenCalledWith(expect.objectContaining({ status: "streaming" }));
  });

  it("rejects arbitrary JSON while streaming was requested", async () => {
    const input = options(JSON.stringify({ ok: true }));
    input.providerResponse = new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });

    const result = await handleStreamingResponse(input);

    expect(result).toMatchObject({ success: false, status: 502, scope: "stream" });
  });

  it.each([[true, "success"], [false, "error"]])("stores terminalSeen=%s as %s", (terminalSeen, status) => {
    const { onStreamComplete } = buildOnStreamComplete({
      provider: "nvidia", model: "model", connectionId: "key", requestStartTime: Date.now(), body: {}, stream: true,
    });

    onStreamComplete({ content: "partial" }, null, Date.now(), { terminalSeen });

    expect(saveRequestDetail).toHaveBeenLastCalledWith(expect.objectContaining({ status }));
  });
});
