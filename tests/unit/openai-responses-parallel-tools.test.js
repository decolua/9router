/**
 * Parallel tool calls from Responses backends (Muse Spark via opencode).
 * Multiple function_call output items arriving before any done must map to
 * distinct Chat tool_calls indices, otherwise downstream merges them into a
 * single tool_use with concatenated JSON (Claude InputValidationError).
 */
import { describe, it, expect } from "vitest";
import { openaiResponsesToOpenAIResponse } from "../../open-sse/translator/response/openai-responses.js";

function newState() {
  return {
    seq: 0,
    responseId: "resp_test",
    created: 123,
    started: false,
    msgTextBuf: {},
    msgItemAdded: {},
    msgContentAdded: {},
    msgItemDone: {},
    reasoningId: "",
    reasoningIndex: -1,
    reasoningBuf: "",
    reasoningPartAdded: false,
    reasoningDone: false,
    inThinking: false,
    funcArgsBuf: {},
    funcNames: {},
    funcCallIds: {},
    funcItemAdded: {},
    funcArgsDone: {},
    funcItemDone: {},
    customToolNames: new Set(),
    completedSent: false,
  };
}

function collectIndices(chunks) {
  const out = [];
  for (const c of chunks) {
    if (!c) continue;
    for (const tc of c.choices?.[0]?.delta?.tool_calls || []) {
      out.push({ index: tc.index, id: tc.id || null, args: tc.function?.arguments ?? null, name: tc.function?.name ?? null });
    }
  }
  return out;
}

describe("responses→openai parallel tool calls", () => {
  it("assigns distinct indices when added events arrive batched", () => {
    const state = newState();
    const chunks = [];
    // Upstream batches all added events before deltas/dones (parallel calls).
    const events = [
      { type: "response.output_item.added", output_index: 0, item: { type: "function_call", call_id: "call_aaa", name: "Read", arguments: "" } },
      { type: "response.output_item.added", output_index: 1, item: { type: "function_call", call_id: "call_bbb", name: "Read", arguments: "" } },
      { type: "response.output_item.added", output_index: 2, item: { type: "function_call", call_id: "call_ccc", name: "Read", arguments: "" } },
      { type: "response.function_call_arguments.delta", item_id: "fc_call_aaa", output_index: 0, delta: '{"file_path":"/tmp/a.txt"}' },
      { type: "response.function_call_arguments.delta", item_id: "fc_call_bbb", output_index: 1, delta: '{"file_path":"/tmp/b.txt"}' },
      { type: "response.function_call_arguments.delta", item_id: "fc_call_ccc", output_index: 2, delta: '{"file_path":"/tmp/c.txt"}' },
      { type: "response.output_item.done", output_index: 0, item: { type: "function_call", call_id: "call_aaa", name: "Read", arguments: '{"file_path":"/tmp/a.txt"}' } },
      { type: "response.output_item.done", output_index: 1, item: { type: "function_call", call_id: "call_bbb", name: "Read", arguments: '{"file_path":"/tmp/b.txt"}' } },
      { type: "response.output_item.done", output_index: 2, item: { type: "function_call", call_id: "call_ccc", name: "Read", arguments: '{"file_path":"/tmp/c.txt"}' } },
    ];
    for (const e of events) {
      const c = openaiResponsesToOpenAIResponse(e, state);
      if (c) chunks.push(c);
    }
    const calls = collectIndices(chunks);
    const headerIndices = [...new Set(calls.filter((c) => c.id).map((c) => c.index))];
    // Three distinct tool calls must have three distinct indices.
    expect(headerIndices).toHaveLength(3);
    // Each delta must land on its own call's index (no cross-contamination).
    const deltaByIndex = new Map(calls.filter((c) => c.args).map((c) => [c.index, c.args]));
    expect(deltaByIndex.get(headerIndices[0])).toContain("a.txt");
    expect(deltaByIndex.get(headerIndices[1])).toContain("b.txt");
    expect(deltaByIndex.get(headerIndices[2])).toContain("c.txt");
  });

  it("keeps sequential tool calls on distinct indices", () => {
    const state = newState();
    const chunks = [];
    const events = [
      { type: "response.output_item.added", output_index: 0, item: { type: "function_call", call_id: "call_111", name: "Read", arguments: "" } },
      { type: "response.function_call_arguments.delta", item_id: "fc_call_111", output_index: 0, delta: '{"file_path":"/tmp/x.txt"}' },
      { type: "response.output_item.done", output_index: 0, item: { type: "function_call", call_id: "call_111", name: "Read", arguments: '{"file_path":"/tmp/x.txt"}' } },
      { type: "response.output_item.added", output_index: 1, item: { type: "function_call", call_id: "call_222", name: "Read", arguments: "" } },
      { type: "response.function_call_arguments.delta", item_id: "fc_call_222", output_index: 1, delta: '{"file_path":"/tmp/y.txt"}' },
      { type: "response.output_item.done", output_index: 1, item: { type: "function_call", call_id: "call_222", name: "Read", arguments: '{"file_path":"/tmp/y.txt"}' } },
    ];
    for (const e of events) {
      const c = openaiResponsesToOpenAIResponse(e, state);
      if (c) chunks.push(c);
    }
    const calls = collectIndices(chunks);
    const headerIndices = [...new Set(calls.filter((c) => c.id).map((c) => c.index))];
    expect(headerIndices).toHaveLength(2);
  });
});
