import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

const { handleStreamingResponse } = await import("../../open-sse/handlers/chatCore/streamingHandler.js");

describe("Claude response model routing", () => {
  it("reports the exact client-selected model for a routed Codex stream", async () => {
    const upstream = [
      "event: response.output_text.delta",
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "ok" })}`,
      "",
      "event: response.completed",
      `data: ${JSON.stringify({ type: "response.completed", response: { status: "completed" } })}`,
      "",
    ].join("\n");

    const result = await handleStreamingResponse({
      providerResponse: new Response(upstream, { headers: { "content-type": "text/event-stream" } }),
      provider: "codex",
      model: "gpt-5.6-sol",
      sourceFormat: "claude",
      targetFormat: "openai-responses",
      body: { model: "codex/gpt-5.6-sol", stream: true, messages: [{ role: "user", content: "hi" }] },
      clientRawRequest: { body: { model: "cx/gpt-5.6-sol" } },
      streamController: {
        signal: new AbortController().signal,
        isConnected: () => true,
        handleComplete: vi.fn(),
        handleError: vi.fn(),
        handleDisconnect: vi.fn(),
        abort: vi.fn(),
      },
    });

    const output = await result.response.text();
    const messageStart = output
      .split("\n")
      .find((line) => line.startsWith("data: ") && line.includes('"type":"message_start"'));

    expect(JSON.parse(messageStart.slice(6)).message.model).toBe("cx/gpt-5.6-sol");
  });
});
