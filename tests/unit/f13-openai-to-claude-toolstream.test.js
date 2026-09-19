// F13 regression: openai→claude response streaming route (T1.2 findings A2, A3, M6).
//
// A2 — `name` arriving in a chunk AFTER the `id` chunk was dropped: the block
//      opened once on `tc.id` and captured name at that instant, so the client
//      saw `content_block_start` with `name: ""`.
// A3 — upstreams (vLLM/compat gateways) that omit `id` on tool_call deltas had
//      their blocks dropped entirely: `stop_reason: "tool_use"` with zero
//      `tool_use` blocks. Siblings (ollama/kiro/commandcode) allocate
//      `fallbackToolCallId(index)`; this route must too.
// M6 — a duplicated `finish_reason` chunk emitted a second `message_delta` +
//      `message_stop`; `state.finishReasonSent` (from `initState`) was never
//      consulted here.
import { describe, it, expect } from "vitest";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";
import { initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// Faithful to the pipeline: stream.js seeds state with initState(clientFormat).
function createState() {
  return initState(FORMATS.CLAUDE);
}

function chunkOf(delta, finish_reason) {
  const choice = { index: 0, delta };
  if (finish_reason) choice.finish_reason = finish_reason;
  return { id: "chatcmpl-f13", model: "gpt-test", choices: [choice] };
}

function collect(chunks) {
  const state = createState();
  const events = [];
  for (const c of chunks) {
    const out = openaiToClaudeResponse(c, state);
    if (Array.isArray(out)) events.push(...out);
    else if (out) events.push(out);
  }
  return { state, events };
}

const blockStarts = (events) => events.filter((e) => e.type === "content_block_start");
const toolStarts = (events) => blockStarts(events).filter((e) => e.content_block?.type === "tool_use");
const jsonDeltas = (events) =>
  events.filter((e) => e.type === "content_block_delta" && e.delta?.type === "input_json_delta");

describe("F13/A2 — late-arriving tool name", () => {
  // Exact scenario from T1.2: chunk1 carries id with null name, chunk2 carries
  // the name with no id, chunk3 finishes with the remaining args.
  const { events } = collect([
    chunkOf({ tool_calls: [{ index: 0, id: "call_1", function: { name: null, arguments: "" } }] }),
    chunkOf({ tool_calls: [{ index: 0, function: { name: "Read", arguments: '{"file_path":' } }] }),
    chunkOf({ tool_calls: [{ index: 0, function: { arguments: '"/tmp/a.ts"}' } }] }, "tool_calls"),
  ]);

  it("opens exactly one tool_use block", () => {
    expect(toolStarts(events)).toHaveLength(1);
  });

  it("content_block_start carries the late name (never name:\"\")", () => {
    const start = toolStarts(events)[0];
    expect(start.content_block.name).toBe("Read");
    expect(start.content_block.id).toBe("call_1");
    for (const s of blockStarts(events)) {
      expect(s.content_block.name ?? "x").not.toBe("");
    }
  });

  it("name is emitted BEFORE the input_json_deltas of that block", () => {
    const startIdx = events.indexOf(toolStarts(events)[0]);
    const deltaIdx = events.indexOf(jsonDeltas(events)[0]);
    expect(deltaIdx).toBeGreaterThan(startIdx);
    expect(jsonDeltas(events)[0].index).toBe(toolStarts(events)[0].index);
  });

  it("arguments stream intact into a single sanitized delta and the block closes", () => {
    expect(JSON.parse(jsonDeltas(events)[0].delta.partial_json)).toEqual({ file_path: "/tmp/a.ts" });
    const stop = events.find((e) => e.type === "content_block_stop" && e.index === toolStarts(events)[0].index);
    expect(stop).toBeDefined();
  });
});

describe("F13/A3 — tool_call deltas without any id", () => {
  // Exact scenario: gateways/vLLM emit index+function fragments only, no id.
  const { events } = collect([
    chunkOf({ tool_calls: [{ index: 0, function: { name: "Read", arguments: '{"file_path":' } }] }),
    chunkOf({ tool_calls: [{ index: 0, function: { arguments: '"/tmp/b.ts"}' } }] }),
    chunkOf({}, "tool_calls"),
  ]);

  it("emits one tool_use block instead of silently dropping it", () => {
    expect(toolStarts(events)).toHaveLength(1);
  });

  it("allocates a fallback id matching the Anthropic tool_use.id pattern", () => {
    const id = toolStarts(events)[0].content_block.id;
    expect(id).toMatch(/^call_0_\d+$/);
    expect(id).toMatch(/^[a-zA-Z0-9_-]+$/);
  });

  it("keeps name, full args and block closure", () => {
    expect(toolStarts(events)[0].content_block.name).toBe("Read");
    expect(JSON.parse(jsonDeltas(events)[0].delta.partial_json)).toEqual({ file_path: "/tmp/b.ts" });
    expect(jsonDeltas(events)).toHaveLength(1);
    expect(events.some((e) => e.type === "content_block_stop" && e.index === toolStarts(events)[0].index)).toBe(true);
    expect(events.some((e) => e.type === "message_delta" && e.delta.stop_reason === "tool_use")).toBe(true);
  });

  it("parallel tools without ids get distinct fallback ids", () => {
    const { events: ev } = collect([
      chunkOf({ tool_calls: [
        { index: 0, function: { name: "A", arguments: "{}" } },
        { index: 1, function: { name: "B", arguments: "{}" } },
      ] }),
      chunkOf({}, "tool_calls"),
    ]);
    const ids = toolStarts(ev).map((e) => e.content_block.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(ids[0]).toMatch(/^call_0_\d+$/);
    expect(ids[1]).toMatch(/^call_1_\d+$/);
  });
});

describe("F13/M6 — duplicated finish_reason", () => {
  const { state, events } = collect([
    chunkOf({ content: "Hi" }),
    chunkOf({}, "stop"),
    chunkOf({}, "stop"),
  ]);

  it("emits exactly one message_stop and one message_delta", () => {
    expect(events.filter((e) => e.type === "message_stop")).toHaveLength(1);
    expect(events.filter((e) => e.type === "message_delta")).toHaveLength(1);
  });

  it("marks finishReasonSent on the shared initState contract", () => {
    expect(state.finishReasonSent).toBe(true);
  });

  it("a duplicated finish after tools does not re-emit tool deltas or stops", () => {
    const r = collect([
      chunkOf({ tool_calls: [{ index: 0, id: "call_x", function: { name: "Read", arguments: '{"a":1}' } }] }),
      chunkOf({}, "tool_calls"),
      chunkOf({}, "tool_calls"),
    ]);
    expect(r.events.filter((e) => e.type === "message_stop")).toHaveLength(1);
    expect(jsonDeltas(r.events)).toHaveLength(1);
    expect(r.events.filter((e) => e.type === "content_block_stop")).toHaveLength(1);
    expect(r.events.filter((e) => e.type === "content_block_start")).toHaveLength(1);
  });
});
