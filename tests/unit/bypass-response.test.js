import { describe, it, expect, vi } from "vitest";

vi.mock("../../open-sse/translator/index.js", () => ({
  translateResponse: vi.fn(),
  initState: vi.fn(() => ({})),
}));
vi.mock("../../open-sse/translator/formats.js", () => ({
  FORMATS: { OPENAI: "openai", CLAUDE: "claude" },
}));
vi.mock("../../open-sse/utils/stream.js", () => ({
  formatSSE: vi.fn(),
}));

const { mergeChunksToResponse } = await import("../../open-sse/utils/bypassResponse.js");

describe("mergeChunksToResponse", () => {
  it("reconstructs non-streaming Claude message content from translated chunks", () => {
    const chunks = [
      {
        type: "message_start",
        message: {
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "demo",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1, cache_read_input_tokens: 2 },
        },
      },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hello world" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 3 } },
      { type: "message_stop" },
    ];

    const result = mergeChunksToResponse(chunks, "claude");

    expect(result.type).toBe("message");
    expect(result.role).toBe("assistant");
    expect(result.content).toEqual([{ type: "text", text: "hello world" }]);
    expect(result.stop_reason).toBe("end_turn");
    expect(result.usage).toEqual({ input_tokens: 1, cache_read_input_tokens: 2, output_tokens: 3 });
  });
});
