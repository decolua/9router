// Regression: Claude Code <- 9Router <- CodeBuddy tool-call stream fidelity.
//
// Four confirmed defects in the OpenAI->Claude streaming translator. Each can
// lose or corrupt the tool state Claude Code's agent loop depends on:
//   1. A tool_call whose upstream omits the optional `id` was silently dropped
//      (block never opened), so the model's tool call vanished.
//   2. Distinct parallel tool calls whose upstream omits the optional `index`
//      collapsed into ONE block (every call defaulted to index 0).
//   3. A tool-call block left open across a later text/thinking block emitted
//      its input_json_delta AFTER an unrelated block, misattributing args.
//   4. A duplicated finish_reason chunk emitted a second message_delta +
//      message_stop (finalization was not idempotent).
import { describe, expect, it } from "vitest";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";

const st = () => ({ toolCalls: new Map(), nextBlockIndex: 0 });
const chunk = (delta, finish) => ({
  id: "chatcmpl-test",
  model: "glm-5.3",
  choices: [{ delta, ...(finish ? { finish_reason: finish } : {}) }],
});

describe("tool-call stream fidelity (CodeBuddy -> Claude Code)", () => {
  it("materialises an id when the upstream omits it, instead of dropping the call", () => {
    const state = st();
    const start = openaiToClaudeResponse(chunk({ tool_calls: [{ index: 0, function: { name: "Bash" } }] }), state);
    const block = start.find((e) => e.type === "content_block_start");
    expect(block).toBeDefined();
    expect(block.content_block.type).toBe("tool_use");
    expect(block.content_block.id).toBeTruthy();

    const done = openaiToClaudeResponse(
      chunk({ tool_calls: [{ index: 0, function: { arguments: '{"command":"ls"}' } }] }, "tool_calls"),
      state
    );
    const args = done.find((e) => e.delta?.type === "input_json_delta");
    expect(JSON.parse(args.delta.partial_json)).toEqual({ command: "ls" });
  });

  it("keeps distinct parallel tool calls separate when upstream omits index", () => {
    const state = st();
    // Two calls, distinct ids, NO index field.
    const start = openaiToClaudeResponse(
      chunk({
        tool_calls: [
          { id: "call_a", function: { name: "Read" } },
          { id: "call_b", function: { name: "Bash" } },
        ],
      }),
      state
    );
    const starts = start.filter((e) => e.type === "content_block_start");
    expect(starts).toHaveLength(2);
    expect(new Set(starts.map((e) => e.content_block.id))).toEqual(new Set(["call_a", "call_b"]));

    const argsChunk = openaiToClaudeResponse(
      chunk({
        tool_calls: [
          { id: "call_a", function: { arguments: '{"file_path":"/a"}' } },
          { id: "call_b", function: { arguments: '{"command":"ls"}' } },
        ],
      }),
      state
    );
    // args are buffered until finish; finish flushes both
    const done = openaiToClaudeResponse(chunk({}, "tool_calls"), state);
    const deltas = [...(argsChunk || []), ...(done || [])].filter((e) => e.delta?.type === "input_json_delta");
    const payloads = deltas.map((e) => JSON.parse(e.delta.partial_json));
    expect(payloads).toContainEqual({ file_path: "/a" });
    expect(payloads).toContainEqual({ command: "ls" });
  });

  it("closes an open tool block before a later text block (no misattributed args)", () => {
    const state = st();
    openaiToClaudeResponse(chunk({ tool_calls: [{ index: 0, id: "call_x", function: { name: "Bash" } }] }), state);
    openaiToClaudeResponse(chunk({ tool_calls: [{ index: 0, function: { arguments: '{"command":"ls"}' } }] }), state);
    const textChunk = openaiToClaudeResponse(chunk({ content: "done" }), state);

    // The tool block must be closed (args emitted + content_block_stop) BEFORE
    // the text block starts.
    const idxStop = textChunk.findIndex((e) => e.delta?.type === "input_json_delta");
    const idxTextStart = textChunk.findIndex(
      (e) => e.type === "content_block_start" && e.content_block.type === "text"
    );
    expect(idxStop).toBeGreaterThanOrEqual(0);
    expect(idxTextStart).toBeGreaterThanOrEqual(0);
    expect(idxStop).toBeLessThan(idxTextStart);
    // exactly one close for the tool block
    expect(textChunk.filter((e) => e.type === "content_block_stop").length).toBe(1);
  });

  it("is idempotent on a duplicated finish_reason chunk", () => {
    const state = st();
    openaiToClaudeResponse(chunk({ tool_calls: [{ index: 0, id: "call_y", function: { name: "Bash" } }] }), state);
    const first = openaiToClaudeResponse(
      chunk({ tool_calls: [{ index: 0, function: { arguments: "{}" } }] }, "tool_calls"),
      state
    );
    expect(first.filter((e) => e.type === "message_stop")).toHaveLength(1);

    const second = openaiToClaudeResponse(chunk({}, "tool_calls"), state);
    expect(second).toBeNull();
  });
});
