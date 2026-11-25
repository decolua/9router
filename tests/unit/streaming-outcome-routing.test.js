import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  trackPendingRequest: vi.fn(),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
}));

import { FORMATS } from "../../open-sse/translator/formats.js";
import { handleStreamingResponse } from "../../open-sse/handlers/chatCore/streamingHandler.js";
import { createStreamController } from "../../open-sse/utils/streamHandler.js";

const encoder = new TextEncoder();
const chunk = (delta, finish = null) =>
  `data: ${JSON.stringify({ id: "c1", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

function sse(frames) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function run(providerResponse, { targetFormat = FORMATS.OPENAI, onRequestSuccess = vi.fn(), onStreamComplete = vi.fn() } = {}) {
  return handleStreamingResponse({
    providerResponse,
    provider: "openai",
    model: "test-model",
    sourceFormat: targetFormat,
    targetFormat,
    userAgent: "",
    body: { messages: [{ role: "user", content: "hi" }] },
    stream: true,
    requestStartTime: Date.now(),
    connectionId: "conn",
    onRequestSuccess,
    streamController: createStreamController({ provider: "openai", model: "test-model" }),
    onStreamComplete,
    streamDetailId: "detail",
    appendLog: vi.fn(),
  });
}

describe("streaming semantic outcome routing", () => {
  it("returns a routable 502 for an error event before any output", async () => {
    const onRequestSuccess = vi.fn();
    const result = await run(sse([`data: ${JSON.stringify({ error: { message: "overloaded" } })}\n\n`]), { onRequestSuccess });

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(result.errorKind).toBe("upstream_payload_error");
    expect(result.error).toContain("overloaded");
    expect(onRequestSuccess).not.toHaveBeenCalled();
  });

  it("returns a routable 502 for a stream that finishes without output", async () => {
    const result = await run(sse([chunk({ role: "assistant" }), chunk({}, "stop"), "data: [DONE]\n\n"]));

    expect(result.success).toBe(false);
    expect(result.errorKind).toBe("empty_upstream_response");
  });

  it("marks success only after a valid terminal, replaying the buffered head", async () => {
    const onRequestSuccess = vi.fn();
    const onStreamComplete = vi.fn();
    const result = await run(
      sse([chunk({ role: "assistant" }), chunk({ content: "hello" }), chunk({}, "stop"), "data: [DONE]\n\n"]),
      { onRequestSuccess, onStreamComplete }
    );

    expect(result.success).toBe(true);
    expect(onRequestSuccess).not.toHaveBeenCalled();
    const text = await result.response.text();
    expect(text).toContain('"role":"assistant"');
    expect(text).toContain("hello");
    await Promise.resolve();
    expect(onRequestSuccess).toHaveBeenCalledTimes(1);
    expect(onStreamComplete.mock.calls[0][3]).toMatchObject({ ok: true });
  });

  it("does not report success for a stream cut off after commit", async () => {
    const onRequestSuccess = vi.fn();
    const onStreamComplete = vi.fn();
    const result = await run(sse([chunk({ content: "partial" })]), { onRequestSuccess, onStreamComplete });

    expect(result.success).toBe(true);
    await result.response.text();
    await Promise.resolve();
    expect(onRequestSuccess).not.toHaveBeenCalled();
    expect(onStreamComplete.mock.calls[0][1]).toBeNull();
    expect(onStreamComplete.mock.calls[0][3]).toMatchObject({ state: "committed_failure", errorKind: "upstream_incomplete" });
  });

  it("keeps the pass-through lifecycle for executor dialects it cannot judge", async () => {
    const onRequestSuccess = vi.fn();
    const result = await run(sse(['{"type":"text-delta","text":"hi"}\n']), { targetFormat: FORMATS.COMMANDCODE, onRequestSuccess });

    expect(result.success).toBe(true);
    await Promise.resolve();
    expect(onRequestSuccess).toHaveBeenCalledTimes(1);
  });

  it("returns 502 for a non-SSE success body", async () => {
    const result = await run(new Response("<html><title>Bad gateway</title></html>", {
      status: 200,
      headers: { "Content-Type": "text/html" },
    }));

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(result.error).toContain("Bad gateway");
  });
});
