import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {})
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const {
  handleForcedSSEToJson,
  parseSSEToOpenAIResponse
} = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");
const { handleNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");

describe("Kiro non-streaming error propagation", () => {
  it("rejects standard SSE that closes without a finish reason or DONE", () => {
    const chunk = 'data: {"choices":[{"delta":{"content":"partial"},"finish_reason":null}]}';
    const cancelled = 'data: {"choices":[{"delta":{},"finish_reason":"cancelled"}]}\n\ndata: [DONE]';

    expect(parseSSEToOpenAIResponse(chunk, "kiro")).toEqual({
      error: {
        message: "Upstream SSE stream ended without a terminal event",
        code: "stream_disconnected",
      },
    });
    expect(parseSSEToOpenAIResponse(`${chunk}\n\ndata: [DONE]`, "kiro")?.choices?.[0]?.finish_reason).toBe("stop");
    expect(parseSSEToOpenAIResponse(cancelled, "kiro")).toEqual({
      error: {
        message: "Upstream SSE stream ended with cancelled",
        code: "stream_failed",
      },
    });
  });

  it("prefers a terminal SSE error over earlier semantic chunks", () => {
    const raw = [
      'data: {"choices":[{"delta":{"content":"partial"},"finish_reason":null}]}',
      'data: {"error":{"message":"Kiro transport failed","code":"kiro_missing_terminal"}}',
      "data: [DONE]"
    ].join("\n\n");

    expect(parseSSEToOpenAIResponse(raw, "kiro")).toEqual({
      error: {
        message: "Kiro transport failed",
        code: "kiro_missing_terminal"
      }
    });
  });

  it("returns 502 instead of collapsing a failed Kiro SSE stream into stop", async () => {
    const encoder = new TextEncoder();
    const raw = [
      'data: {"choices":[{"delta":{"content":"partial"},"finish_reason":null}]}',
      'data: {"error":{"message":"Kiro stream ended incompletely","code":"kiro_missing_terminal"}}',
      "data: [DONE]",
      ""
    ].join("\n\n");
    const result = await handleForcedSSEToJson({
      providerResponse: new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(raw));
          controller.close();
        }
      }), { headers: { "content-type": "text/event-stream" } }),
      sourceFormat: FORMATS.OPENAI,
      provider: "kiro",
      model: "kr/claude-opus-4.8",
      body: { model: "kr/claude-opus-4.8", messages: [] },
      stream: false,
      requestStartTime: Date.now(),
      connectionId: "test-connection",
      clientRawRequest: { endpoint: "/v1/chat/completions" },
      trackDone: vi.fn(),
      appendLog: vi.fn()
    });
    const json = await result.response.json();

    expect(result.success).toBe(false);
    expect(result.response.status).toBe(502);
    expect(json.error.message).toContain("Kiro stream ended incompletely");
    expect(json).not.toHaveProperty("choices");
  });

  it("does not mark parsed SSE errors successful in the generic non-stream handler", async () => {
    const onRequestSuccess = vi.fn();
    const appendLog = vi.fn();
    const result = await handleNonStreamingResponse({
      providerResponse: new Response(
        'data: {"choices":[{"delta":{"content":"partial"},"finish_reason":null}]}',
        { headers: { "content-type": "text/event-stream" } },
      ),
      provider: "kiro",
      model: "claude-opus-4.8",
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI,
      body: { model: "kiro/claude-opus-4.8", messages: [] },
      stream: false,
      requestStartTime: Date.now(),
      connectionId: "test-connection",
      clientRawRequest: { endpoint: "/v1/chat/completions" },
      onRequestSuccess,
      reqLogger: {
        logProviderResponse: vi.fn(),
        logConvertedResponse: vi.fn(),
      },
      trackDone: vi.fn(),
      appendLog,
    });
    await Promise.resolve();

    expect(result.success).toBe(false);
    expect(result.response.status).toBe(502);
    expect(onRequestSuccess).not.toHaveBeenCalled();
    expect(appendLog).toHaveBeenCalledWith({ status: "FAILED 502" });
  });
});
