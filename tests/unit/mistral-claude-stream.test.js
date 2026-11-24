import { describe, expect, it } from "vitest";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";

describe("Mistral structured content through Claude SSE", () => {
  it("keeps thinking out of visible text and completes tool/result turns", () => {
    const state = { toolCalls: new Map(), nextBlockIndex: 0 };
    const convert = (delta, finish_reason = null) => openaiToClaudeResponse({
      id: "chatcmpl-mistral-fixture", model: "mistral-large-latest",
      choices: [{ delta, finish_reason }],
    }, state) || [];
    const events = [
      ...convert({ content: [{ type: "thinking", thinking: [{ type: "text", text: "Check the fixture." }], closed: true }] }),
      ...convert({ content: [{ type: "text", text: "Reading." }] }),
      ...convert({ tool_calls: [{ index: 0, id: "call_read", function: { name: "Read", arguments: '{"file_path":"/fixture/test.ts"}' } }] }, "tool_calls"),
    ];
    const deltas = events.filter(e => e.type === "content_block_delta").map(e => e.delta);
    expect(deltas.filter(d => d.type === "text_delta")).toEqual([{ type: "text_delta", text: "Reading." }]);
    expect(deltas.filter(d => d.type === "thinking_delta")).toEqual([{ type: "thinking_delta", thinking: "Check the fixture." }]);
    expect(deltas.find(d => d.type === "input_json_delta").partial_json).toBe('{"file_path":"/fixture/test.ts"}');
    expect(events.filter(e => e.type === "message_stop")).toHaveLength(1);
    expect(events.find(e => e.type === "message_delta").delta.stop_reason).toBe("tool_use");
  });

  it("leaves ordinary text unchanged and ignores non-text content", () => {
    for (const content of ["DONE", [{ type: "text", text: "DO" }, { type: "text", text: "NE" }, { type: "image_url", image_url: {} }]]) {
      const events = openaiToClaudeResponse({ choices: [{ delta: { content }, finish_reason: "stop" }] }, { toolCalls: new Map(), nextBlockIndex: 0 });
      expect(events.find(e => e.delta?.type === "text_delta").delta.text).toBe("DONE");
    }
  });
});
