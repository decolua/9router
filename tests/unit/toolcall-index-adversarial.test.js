// Regression: tool-call index handling must survive the adversarial shapes a
// real OpenAI-compatible upstream can emit. These are second-order bugs exposed
// after the first audit's synthetic-index fix.
//
//  1. index REUSED for a NEW id — the second call was merged into the first
//     (same provider index) and silently dropped.
//  2. MIXED explicit index and omitted index — a fragment with no index and a
//     fresh id could allocate a synthetic key that collided with a provider
//     index, misrouting args to another call.
//  3. ARGS-BEFORE-IDENTITY — an arguments fragment arriving before the id/name
//     fragment was discarded (block not yet open), truncating the tool input.
//  4. CONTENT AFTER finish_reason — a trailing delta opened a block after
//     message_stop (invalid ordering).
import { describe, expect, it } from "vitest";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";

const st = () => ({ toolCalls: new Map(), nextBlockIndex: 0 });
const chunk = (delta, finish) => ({ id: "c", model: "m", choices: [{ delta, ...(finish ? { finish_reason: finish } : {}) }] });

const starts = (events) => (events || []).filter((e) => e.type === "content_block_start" && e.content_block?.type === "tool_use");
const argDeltas = (events) => (events || []).filter((e) => e.delta?.type === "input_json_delta");

describe("tool-call index adversarial shapes", () => {
  it("treats an index reused for a NEW id as a distinct call", () => {
    const state = st();
    const e1 = openaiToClaudeResponse(chunk({ tool_calls: [{ index: 0, id: "call_a", function: { name: "Bash" } }] }), state);
    const e2 = openaiToClaudeResponse(chunk({ tool_calls: [{ index: 0, function: { arguments: '{"command":"ls"}' } }] }), state);
    // Same index 0, different id -> must be a NEW tool call, not merged.
    const e3 = openaiToClaudeResponse(chunk({ tool_calls: [{ index: 0, id: "call_b", function: { name: "Read" } }] }), state);
    const e4 = openaiToClaudeResponse(chunk({ tool_calls: [{ index: 0, function: { arguments: '{"file_path":"/a"}' } }] }, "tool_calls"), state);

    const allStarts = [...starts(e1), ...starts(e2), ...starts(e3), ...starts(e4)];
    expect(allStarts).toHaveLength(2);
    expect(new Set(allStarts.map((s) => s.content_block.id))).toEqual(new Set(["call_a", "call_b"]));

    const payloads = [...argDeltas(e1), ...argDeltas(e2), ...argDeltas(e3), ...argDeltas(e4)]
      .map((d) => JSON.parse(d.delta.partial_json));
    expect(payloads).toContainEqual({ command: "ls" });
    expect(payloads).toContainEqual({ file_path: "/a" });
  });

  it("keeps calls separate when explicit index mixes with omitted index", () => {
    const state = st();
    // Provider index 0, then an id-less-and-index-less... actually id present, no index.
    openaiToClaudeResponse(chunk({ tool_calls: [{ index: 0, id: "p0", function: { name: "A" } }] }), state);
    openaiToClaudeResponse(chunk({ tool_calls: [{ id: "noidx", function: { name: "B" } }] }), state);
    const done = openaiToClaudeResponse(
      chunk({ tool_calls: [{ index: 0, function: { arguments: '{"a":1}' } }, { id: "noidx", function: { arguments: '{"b":2}' } }] }, "tool_calls"),
      state
    );
    const payloads = argDeltas(done).map((d) => JSON.parse(d.delta.partial_json));
    expect(payloads).toContainEqual({ a: 1 });
    expect(payloads).toContainEqual({ b: 2 });
  });

  it("keeps arguments that arrive BEFORE the id/name fragment", () => {
    const state = st();
    // args first (no identity)
    openaiToClaudeResponse(chunk({ tool_calls: [{ index: 0, function: { arguments: '{"a":1}' } }] }), state);
    // identity second
    const open = openaiToClaudeResponse(chunk({ tool_calls: [{ index: 0, id: "call_x", function: { name: "F" } }] }), state);
    const done = openaiToClaudeResponse(chunk({}, "tool_calls"), state);
    expect(starts(open)).toHaveLength(1);
    const payloads = argDeltas(done).map((d) => JSON.parse(d.delta.partial_json));
    expect(payloads).toContainEqual({ a: 1 });
  });

  it("ignores content deltas that arrive after finish_reason", () => {
    const state = st();
    openaiToClaudeResponse(chunk({ content: "hi" }), state);
    const finished = openaiToClaudeResponse(chunk({}, "stop"), state);
    expect(finished.filter((e) => e.type === "message_stop")).toHaveLength(1);

    // A belated content chunk must not open a new block after message_stop.
    const late = openaiToClaudeResponse(chunk({ content: "sneaky" }), state);
    expect(late).toBeNull();
  });
});
