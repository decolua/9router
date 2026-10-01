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

describe("Kiro non-streaming error propagation", () => {
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
});
