import { describe, expect, it } from "vitest";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";

function createState() {
  return { toolCalls: new Map(), nextBlockIndex: 0 };
}

function chunk(toolCalls, finishReason) {
  return {
    id: "chatcmpl-collision",
    model: "test-model",
    choices: [{ delta: { tool_calls: toolCalls }, ...(finishReason ? { finish_reason: finishReason } : {}) }],
  };
}

function startEvents(state) {
  return state.toolCalls;
}

describe("openaiToClaudeResponse multi-tool index tracking", () => {
  it("keeps two tool calls with distinct upstream indices on separate blocks", () => {
    const state = createState();
    const events = openaiToClaudeResponse(chunk([
      { index: 0, id: "call_a", function: { name: "Bash", arguments: '{"command":"ls"}' } },
      { index: 1, id: "call_b", function: { name: "Read", arguments: '{"file_path":"a.txt"}' } },
    ]), state);
    const starts = events.filter((e) => e.type === "content_block_start");
    expect(starts).toHaveLength(2);
    expect(starts[0].index).not.toBe(starts[1].index);
  });

  it("remaps a second tool id reusing index 0 instead of concatenating JSON", () => {
    const state = createState();
    openaiToClaudeResponse(chunk([{ index: 0, id: "call_1", function: { name: "Bash" } }]), state);
    openaiToClaudeResponse(chunk([{ index: 0, function: { arguments: '{"command":"first"}' } }]), state);
    // Upstream bug: second tool arrives with a new id but the same index 0.
    const second = openaiToClaudeResponse(chunk([{ index: 0, id: "call_2", function: { name: "Read" } }]), state);
    openaiToClaudeResponse(chunk([{ index: 0, function: { arguments: '{"path":"b.txt"}' } }]), state);
    const events = openaiToClaudeResponse(chunk([], "tool_calls"), state);

    const deltas = events.filter((e) => e.delta?.type === "input_json_delta");
    expect(deltas).toHaveLength(2);
    for (const d of deltas) expect(() => JSON.parse(d.delta.partial_json)).not.toThrow();
    // No delta may contain concatenated objects "{...}{...}".
    for (const d of deltas) expect(d.delta.partial_json).not.toMatch(/\}\s*\{/);
    // Read path alias normalized to file_path.
    const readDelta = deltas.find((d) => d.delta.partial_json.includes("b.txt"));
    expect(JSON.parse(readDelta.delta.partial_json).file_path).toBe("b.txt");
    // Two distinct tool blocks opened.
    expect(second.some((e) => e.type === "content_block_start")).toBe(true);
    expect(startEvents(state).size).toBe(2);
  });

  it("normalizes filePath alias for Edit and Write tools", () => {
    for (const name of ["Edit", "Write"]) {
      const state = createState();
      openaiToClaudeResponse(chunk([{ index: 0, id: `call_${name}`, function: { name } }]), state);
      const events = openaiToClaudeResponse(chunk([
        { index: 0, function: { arguments: JSON.stringify({ filePath: "c.txt", content: "x" }) } },
      ], "tool_calls"), state);
      const delta = events.find((e) => e.delta?.type === "input_json_delta");
      const parsed = JSON.parse(delta.delta.partial_json);
      expect(parsed.file_path).toBe("c.txt");
      expect(parsed.filePath).toBeUndefined();
      expect(parsed.path).toBeUndefined();
    }
  });
});
