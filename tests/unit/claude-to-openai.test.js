import { describe, expect, it } from "vitest";
import { claudeToOpenAIResponse } from "../../open-sse/translator/response/claude-to-openai.js";

function collect(events) {
  const state = {
    toolCalls: new Map(),
    toolNameMap: new Map(),
  };
  return events.flatMap((event) => claudeToOpenAIResponse(event, state) || []);
}

describe("claude-to-openai thinking blocks", () => {
  it("maps Anthropic thinking deltas to reasoning_content without leaking think tags as content", () => {
    const chunks = collect([
      {
        type: "message_start",
        message: { id: "msg_test", model: "MiniMax-M2.7" },
      },
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "thinking", thinking: "" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "thinking..." },
      },
      {
        type: "content_block_stop",
        index: 0,
      },
      {
        type: "content_block_start",
        index: 1,
        content_block: { type: "text", text: "" },
      },
      {
        type: "content_block_delta",
        index: 1,
        delta: { type: "text_delta", text: "final answer" },
      },
    ]);

    const deltas = chunks.map((chunk) => chunk.choices[0].delta);

    expect(deltas).toContainEqual({ role: "assistant" });
    expect(deltas).toContainEqual({ reasoning_content: "thinking..." });
    expect(deltas).toContainEqual({ content: "final answer" });
    expect(deltas).not.toContainEqual({ content: "<think>" });
    expect(deltas).not.toContainEqual({ content: "</think>" });
  });
});
