// Parallel function_calls from a Responses upstream must stay on separate
// chat tool_calls indices. Regression: response/openai-responses.js attributed
// every arguments delta to the positional toolCallIndex (advanced only on
// output_item.done), so all-added-then-deltas ordering concatenated N JSON
// payloads into index 0 and clients failed with InputValidationError.
import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { openaiResponsesToOpenAIResponse } from "../../open-sse/translator/response/openai-responses.js";
import { clampResponsesCallId, MAX_RESPONSES_CALL_ID_LEN } from "../../open-sse/translator/formats/responsesApi.js";
import { initState, translateResponse } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const added = (id, call_id, name, type = "function_call") => ({
  type: "response.output_item.added",
  item: { id, type, call_id, name, arguments: "" },
});
const delta = (item_id, text) => ({
  type: "response.function_call_arguments.delta",
  item_id,
  delta: text,
});
const done = (id, call_id, name) => ({
  type: "response.output_item.done",
  item: { id, type: "function_call", call_id, name },
});

// Reassemble translated chunks the way an OpenAI client accumulator does.
function accumulate(calls, chunks) {
  for (const chunk of chunks) {
    if (!chunk) continue;
    for (const tc of chunk.choices?.[0]?.delta?.tool_calls || []) {
      const slot = (calls[tc.index] ??= { id: null, name: "", args: "" });
      if (tc.id) slot.id = tc.id;
      if (tc.function?.name) slot.name = tc.function.name;
      if (tc.function?.arguments) slot.args += tc.function.arguments;
    }
  }
  return calls;
}

function runStream(events) {
  const state = {};
  const chunks = [];
  for (const ev of events) {
    const out = openaiResponsesToOpenAIResponse(ev, state);
    if (out) chunks.push(out);
  }
  const flush = openaiResponsesToOpenAIResponse(null, state);
  if (flush) chunks.push(flush);
  return { state, chunks };
}

const PAYLOADS = [
  '{"file_path":"/docs/PRODUCT.md"}',
  '{"file_path":"/docs/ROADMAP.md"}',
  '{"file_path":"/docs/openapi.custom.yaml"}',
  '{"file_path":"/docs/.gitignore"}',
];

function hostileOrdering() {
  const events = PAYLOADS.map((_, i) => added(`fc_${i}`, `call_${i}`, "read_file"));
  // Interleaved deltas AFTER all addeds — the ordering that used to merge all
  // four payloads into index 0.
  PAYLOADS.forEach((p, i) => events.push(delta(`fc_${i}`, p.slice(0, 20)), delta(`fc_${i}`, p.slice(20))));
  PAYLOADS.forEach((_, i) => events.push(done(`fc_${i}`, `call_${i}`, "read_file")));
  return events;
}

describe("responses parallel tool calls keep their own index", () => {
  it("all-added-then-deltas ordering yields 4 separately parseable calls", () => {
    const { chunks } = runStream(hostileOrdering());
    const calls = accumulate({}, chunks);
    expect(Object.keys(calls)).toHaveLength(4);
    PAYLOADS.forEach((p, i) => {
      expect(calls[i].id).toBe(`call_${i}`);
      expect(calls[i].name).toBe("read_file");
      expect(JSON.parse(calls[i].args)).toEqual(JSON.parse(p));
    });
  });

  it("sequential ordering still yields indices 0,1 in order", () => {
    const events = [
      added("fc_0", "call_0", "read_file"),
      delta("fc_0", PAYLOADS[0]),
      done("fc_0", "call_0", "read_file"),
      added("fc_1", "call_1", "read_file"),
      delta("fc_1", PAYLOADS[1]),
      done("fc_1", "call_1", "read_file"),
    ];
    const { chunks } = runStream(events);
    const calls = accumulate({}, chunks);
    expect(Object.keys(calls)).toEqual(["0", "1"]);
    expect(JSON.parse(calls[0].args)).toEqual(JSON.parse(PAYLOADS[0]));
    expect(JSON.parse(calls[1].args)).toEqual(JSON.parse(PAYLOADS[1]));
  });

  it("done carrying full arguments (no deltas) emits them once", () => {
    const state = {};
    const out1 = openaiResponsesToOpenAIResponse(added("fc_9", "call_9", "read_file"), state);
    const out2 = openaiResponsesToOpenAIResponse({
      type: "response.output_item.done",
      item: { id: "fc_9", type: "function_call", call_id: "call_9", name: "read_file", arguments: PAYLOADS[0] },
    }, state);
    const calls = accumulate({}, [out1, out2]);
    expect(JSON.parse(calls[0].args)).toEqual(JSON.parse(PAYLOADS[0]));
  });

  it("deltas without item_id fall back to the most recent call (legacy behavior)", () => {
    const events = [
      added("fc_0", "call_0", "read_file"),
      { type: "response.function_call_arguments.delta", delta: PAYLOADS[0] },
      done("fc_0", "call_0", "read_file"),
    ];
    const { chunks } = runStream(events);
    const calls = accumulate({}, chunks);
    expect(JSON.parse(calls[0].args)).toEqual(JSON.parse(PAYLOADS[0]));
  });
});

describe("responses → claude end-to-end keeps parallel tool_use blocks separate", () => {
  it("four read_file calls arrive as four parseable tool_use blocks", () => {
    const state = initState(FORMATS.CLAUDE);
    const out = [];
    for (const ev of hostileOrdering()) {
      for (const r of translateResponse(FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE, ev, state)) out.push(r);
    }
    for (const r of translateResponse(FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE, null, state)) out.push(r);

    const starts = out.filter((r) => r?.type === "content_block_start" && r?.content_block?.type === "tool_use");
    expect(starts).toHaveLength(4);
    const partials = out.filter((r) => r?.delta?.type === "input_json_delta");
    expect(partials).toHaveLength(4);
    const bodies = partials.map((r) => JSON.parse(r.delta.partial_json).file_path).sort();
    expect(bodies).toEqual([
      "/docs/.gitignore",
      "/docs/PRODUCT.md",
      "/docs/ROADMAP.md",
      "/docs/openapi.custom.yaml",
    ]);
  });
});

describe("fallback call_ids stay unique within a batch", () => {
  it("same-millisecond fallbacks never collide", () => {
    const ids = new Set(Array.from({ length: 50 }, () => clampResponsesCallId(undefined)));
    expect(ids.size).toBe(50);
    for (const id of ids) {
      expect(id.startsWith("call_")).toBe(true);
      expect(id.length).toBeLessThanOrEqual(MAX_RESPONSES_CALL_ID_LEN);
    }
    expect(new Set([clampResponsesCallId(""), clampResponsesCallId(null)]).size).toBe(2);
  });
});
