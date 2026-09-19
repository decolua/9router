// F13-r regression: the openai→claude response route must not gate its own
// finish handling on `state.finishReasonSent`.
//
// initState() returns ONE flat state object that every leg of a double-hop
// pivot shares (translateResponse: `<upstream>:openai` then `openai:<client>`).
// `finishReasonSent` is owned/written by response/openai-responses.js, which
// sets it while producing the chunk that terminates the stream. When
// response/openai-to-claude.js read that same key as its duplicate-finish
// guard (introduced in cc4c716a), a Responses-API upstream feeding a Claude
// client swallowed its own finish: buffered tool args were never flushed,
// tool_use blocks stayed open, and no message_delta/message_stop was emitted.
// Duplicate suppression still works — it just has to live on a key this route
// owns. See unit/responses-parallel-tool-calls.test.js for the end-to-end form.
import { describe, it, expect } from "vitest";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";
import { initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

function chunkOf(delta, finish_reason) {
  const choice = { index: 0, delta };
  if (finish_reason) choice.finish_reason = finish_reason;
  return { id: "chatcmpl-f13r", model: "gpt-test", choices: [choice] };
}

function run(chunks, state = initState(FORMATS.CLAUDE)) {
  const events = [];
  for (const c of chunks) {
    const out = openaiToClaudeResponse(c, state);
    if (Array.isArray(out)) events.push(...out);
    else if (out) events.push(out);
  }
  return { state, events };
}

const jsonDeltas = (events) =>
  events.filter((e) => e.type === "content_block_delta" && e.delta?.type === "input_json_delta");

describe("F13-r — finish-guard key ownership on the openai→claude route", () => {
  it("terminates a stream whose sibling leg already set finishReasonSent", () => {
    const state = initState(FORMATS.CLAUDE);
    // Exactly what openaiResponsesToOpenAIResponse does before handing the
    // terminating chunk to this route.
    state.finishReasonSent = true;

    const { events } = run([
      chunkOf({ tool_calls: [{ index: 0, id: "call_0", function: { name: "read_file", arguments: "" } }] }),
      chunkOf({ tool_calls: [{ index: 0, function: { arguments: '{"file_path":"/a.md"}' } }] }),
      chunkOf({}, "tool_calls"),
    ], state);

    expect(jsonDeltas(events)).toHaveLength(1);
    expect(JSON.parse(jsonDeltas(events)[0].delta.partial_json)).toEqual({ file_path: "/a.md" });
    const start = events.find((e) => e.type === "content_block_start");
    expect(events.some((e) => e.type === "content_block_stop" && e.index === start.index)).toBe(true);
    expect(events.filter((e) => e.type === "message_stop")).toHaveLength(1);
    expect(events.filter((e) => e.type === "message_delta")[0].delta.stop_reason).toBe("tool_use");
  });

  it("still suppresses a duplicated finish_reason (F13/M6) using its own key", () => {
    const { state, events } = run([
      chunkOf({ tool_calls: [{ index: 0, id: "call_x", function: { name: "Read", arguments: '{"a":1}' } }] }),
      chunkOf({}, "tool_calls"),
      chunkOf({}, "tool_calls"),
    ]);

    expect(events.filter((e) => e.type === "message_stop")).toHaveLength(1);
    expect(events.filter((e) => e.type === "message_delta")).toHaveLength(1);
    expect(jsonDeltas(events)).toHaveLength(1);
    expect(events.filter((e) => e.type === "content_block_stop")).toHaveLength(1);
    // The shared contract is still advertised for downstream consumers.
    expect(state.finishReasonSent).toBe(true);
    expect(state.openaiToClaudeFinishSent).toBe(true);
  });

  it("never opens a tool_use block with an empty name when the name never resolves", () => {
    const { events } = run([
      chunkOf({ tool_calls: [{ index: 0, id: "call_n", function: { name: null, arguments: "{}" } }] }),
      chunkOf({}, "tool_calls"),
    ]);
    const start = events.find((e) => e.type === "content_block_start" && e.content_block?.type === "tool_use");
    expect(start.content_block.name).toBe("unknown_tool");
  });
});
