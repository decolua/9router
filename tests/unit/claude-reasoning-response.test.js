import { describe, it, expect } from "vitest";
import { claudeToOpenAIResponse } from "../../open-sse/translator/response/claude-to-openai.js";

function collect(chunks) {
  const state = { toolCalls: new Map() };
  return chunks.flatMap((chunk) => claudeToOpenAIResponse(chunk, state) || []);
}

describe("Claude reasoning response translation (#2158)", () => {
  it("keeps thinking deltas in reasoning_content without leaking think tags into content", () => {
    const output = collect([
      { type: "message_start", message: { id: "msg_12345678", model: "claude", usage: {} } },
      { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "private chain" } },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "visible answer" } },
      { type: "content_block_stop", index: 1 },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { input_tokens: 1, output_tokens: 2 } },
    ]);

    const contentDeltas = output.map((chunk) => chunk.choices?.[0]?.delta?.content).filter(Boolean);
    const content = contentDeltas.join("");
    const reasoning = output.map((chunk) => chunk.choices?.[0]?.delta?.reasoning_content || "").join("");

    expect(contentDeltas).toEqual(["visible answer"]);
    expect(contentDeltas).not.toContain("<think>");
    expect(contentDeltas).not.toContain("</think>");
    expect(content).toBe("visible answer");
    expect(reasoning).toBe("private chain");
  });
});
