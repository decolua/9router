import { describe, it, expect } from "vitest";

const { parseClaudeSSEToMessage } = await import("../../open-sse/handlers/chatCore/claudeSSEToMessage.js");

// Shape of a real Anthropic stream, trimmed to the events that carry state.
const sse = (events) => events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n`).join("\n");

const textStream = sse([
  { type: "message_start", message: { id: "msg_01", type: "message", role: "assistant", model: "claude-haiku-4-5-20251001", content: [], stop_reason: null, usage: { input_tokens: 2812, cache_read_input_tokens: 1200 } } },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "O" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "K" } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 4 } },
  { type: "message_stop" },
]);

describe("parseClaudeSSEToMessage", () => {
  it("rebuilds the text and keeps the Anthropic Message shape", () => {
    const msg = parseClaudeSSEToMessage(textStream, "fallback-model");
    expect(msg.content).toEqual([{ type: "text", text: "OK" }]);
    expect(msg.role).toBe("assistant");
    expect(msg.model).toBe("claude-haiku-4-5-20251001");
    expect(msg.stop_reason).toBe("end_turn");
  });

  it("merges message_start input/cache tokens with the message_delta output tokens", () => {
    // message_delta carries only output_tokens: a plain overwrite would zero the
    // prompt side and make a cached request look free.
    const msg = parseClaudeSSEToMessage(textStream);
    expect(msg.usage).toEqual({ input_tokens: 2812, cache_read_input_tokens: 1200, output_tokens: 4 });
  });

  it("falls back to the requested model when message_start carries none", () => {
    const msg = parseClaudeSSEToMessage(sse([
      { type: "message_start", message: { id: "msg_02", role: "assistant", content: [] } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hi" } },
    ]), "claude-sonnet-5");
    expect(msg.model).toBe("claude-sonnet-5");
  });

  it("assembles tool_use input from input_json_delta fragments", () => {
    const msg = parseClaudeSSEToMessage(sse([
      { type: "message_start", message: { id: "msg_03", role: "assistant", model: "m", content: [] } },
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_01", name: "get_weather", input: {} } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"city":' } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '"Rome"}' } },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 11 } },
    ]), null);
    expect(msg.content).toEqual([{ type: "tool_use", id: "toolu_01", name: "get_weather", input: { city: "Rome" } }]);
    expect(msg.stop_reason).toBe("tool_use");
  });

  it("keeps thinking blocks in order alongside text", () => {
    const msg = parseClaudeSSEToMessage(sse([
      { type: "message_start", message: { id: "msg_04", role: "assistant", model: "m", content: [] } },
      { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "hmm" } },
      { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig123" } },
      { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "answer" } },
    ]), null);
    expect(msg.content).toEqual([
      { type: "thinking", thinking: "hmm", signature: "sig123" },
      { type: "text", text: "answer" },
    ]);
  });

  it("surfaces a mid-stream error instead of returning an empty message", () => {
    const parsed = parseClaudeSSEToMessage(sse([
      { type: "message_start", message: { id: "msg_05", role: "assistant", model: "m", content: [] } },
      { type: "error", error: { type: "overloaded_error", message: "Overloaded" } },
    ]), null);
    expect(parsed.error).toEqual({ type: "overloaded_error", message: "Overloaded" });
  });

  it("returns null when the stream carried no message_start", () => {
    expect(parseClaudeSSEToMessage("", null)).toBeNull();
    expect(parseClaudeSSEToMessage("data: not-json\n\ndata: [DONE]\n", null)).toBeNull();
  });
});
