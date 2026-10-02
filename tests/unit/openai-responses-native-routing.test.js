import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

const { handleStreamingResponse } = await import("../../open-sse/handlers/chatCore/streamingHandler.js");
const { createStreamController } = await import("../../open-sse/utils/streamHandler.js");
const { FORMATS } = await import("../../open-sse/translator/formats.js");

async function routeCodexSSE(events) {
  const raw = [
    ...events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}`),
    "data: [DONE]",
    "",
  ].join("\n\n");
  const providerResponse = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(raw));
      controller.close();
    },
  }), { headers: { "content-type": "text/event-stream" } });

  const result = await handleStreamingResponse({
    providerResponse,
    provider: "codex",
    model: "gpt-5.5",
    sourceFormat: FORMATS.OPENAI_RESPONSES,
    targetFormat: FORMATS.OPENAI_RESPONSES,
    userAgent: "codex-cli/0.144.1",
    body: { model: "gpt-5.5", input: "probe", stream: true },
    stream: true,
    requestStartTime: Date.now(),
    connectionId: "test-codex-native-routing",
    streamController: createStreamController({ provider: "codex", model: "gpt-5.5" }),
  });
  expect(result.success).toBe(true);
  return result.response.text();
}

describe("Codex CLI native Responses routing", () => {
  it("fails a reasoning-only completion on the codex-cli user-agent path", async () => {
    const wire = await routeCodexSSE([
      { type: "response.created", response: { id: "resp_empty", status: "in_progress" } },
      {
        type: "response.output_item.done",
        output_index: 0,
        item: { type: "reasoning", summary: [{ type: "summary_text", text: "thinking" }] },
      },
      { type: "response.completed", response: { id: "resp_empty", status: "completed" } },
    ]);

    expect(wire).toContain("event: response.failed");
    expect(wire).toContain('"code":"empty_output"');
    expect(wire).not.toContain("event: response.completed");
  });

  it("keeps a valid native completion on the codex-cli user-agent path", async () => {
    const wire = await routeCodexSSE([
      { type: "response.created", response: { id: "resp_answer", status: "in_progress" } },
      {
        type: "response.output_item.done",
        output_index: 0,
        item: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "answer" }],
        },
      },
      { type: "response.completed", response: { id: "resp_answer", status: "completed" } },
    ]);

    expect(wire).toContain("event: response.completed");
    expect(wire).not.toContain("event: response.failed");
  });

  it("fails a native completion that mixes answer text with a malformed custom call", async () => {
    const wire = await routeCodexSSE([
      { type: "response.created", response: { id: "resp_mixed", status: "in_progress" } },
      {
        type: "response.output_item.done",
        output_index: 0,
        item: { type: "message", role: "assistant", content: [{ type: "output_text", text: "answer" }] },
      },
      {
        type: "response.output_item.done",
        output_index: 1,
        item: { type: "custom_tool_call", call_id: "call_bad", name: "", input: "run" },
      },
      { type: "response.completed", response: { id: "resp_mixed", status: "completed" } },
    ]);

    expect(wire).toContain("event: response.failed");
    expect(wire).toContain('"code":"invalid_tool_call"');
    expect(wire).not.toContain("event: response.completed");
  });
});
