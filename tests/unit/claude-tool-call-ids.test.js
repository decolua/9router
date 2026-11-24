import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { initState, translateResponse } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const startTool = (index, id, name) => ({
  type: "content_block_start", index,
  content_block: { type: "tool_use", id, name, input: {} },
});
const argsDelta = (index, partial_json) => ({
  type: "content_block_delta", index,
  delta: { type: "input_json_delta", partial_json },
});

function toolStream() {
  return [
    { type: "message_start", message: { id: "msg_tools", model: "claude-opus-5" } },
    { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Look up both cities." } },
    { type: "content_block_stop", index: 0 },
    { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Checking the weather." } },
    { type: "content_block_stop", index: 1 },
    startTool(2, "toolu_paris", "get_weather"),
    argsDelta(2, '{"city":'),
    argsDelta(2, '"Paris"}'),
    { type: "content_block_stop", index: 2 },
    startTool(3, "toolu_seoul", "get_weather"),
    argsDelta(3, '{"city":'),
    argsDelta(3, '"Seoul"}'),
    { type: "content_block_stop", index: 3 },
    { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 20 } },
    { type: "message_stop" },
  ];
}

function translate(events, clientFormat = FORMATS.OPENAI) {
  const state = initState(clientFormat);
  const chunks = [];
  for (const event of [...events, null]) {
    const output = translateResponse(FORMATS.CLAUDE, clientFormat, event, state);
    // Capture each chunk as it would be serialized before the next event arrives.
    chunks.push(...JSON.parse(JSON.stringify(output || [])));
  }
  return chunks;
}

describe("Claude streaming tool-call identity (#4918)", () => {
  it("announces each tool once with dense indices after thinking and text blocks", () => {
    const deltas = translate(toolStream()).flatMap((chunk) => chunk.choices?.[0]?.delta?.tool_calls || []);
    const starts = deltas.filter((delta) => delta.type === "function");
    expect(starts).toEqual([
      { index: 0, id: "toolu_paris", type: "function", function: { name: "get_weather", arguments: "" } },
      { index: 1, id: "toolu_seoul", type: "function", function: { name: "get_weather", arguments: "" } },
    ]);
    expect(deltas.filter((delta) => !delta.type)).toEqual([
      { index: 0, function: { arguments: '{"city":' } },
      { index: 0, function: { arguments: '"Paris"}' } },
      { index: 1, function: { arguments: '{"city":' } },
      { index: 1, function: { arguments: '"Seoul"}' } },
    ]);
  });

  it("preserves the original IDs when a client concatenates streamed string fields", () => {
    const calls = [];
    for (const chunk of translate(toolStream())) {
      for (const delta of chunk.choices?.[0]?.delta?.tool_calls || []) {
        // OpenAI SDK accumulators concatenate string deltas, including id/name.
        const call = (calls[delta.index] ??= { id: "", name: "", arguments: "" });
        call.id += delta.id || "";
        call.name += delta.function?.name || "";
        call.arguments += delta.function?.arguments || "";
      }
    }
    expect(calls).toEqual([
      { id: "toolu_paris", name: "get_weather", arguments: '{"city":"Paris"}' },
      { id: "toolu_seoul", name: "get_weather", arguments: '{"city":"Seoul"}' },
    ]);
  });

  it("keeps empty-argument calls identifiable", () => {
    const chunks = translate([
      { type: "message_start", message: { id: "msg_empty", model: "claude-opus-5" } },
      startTool(0, "toolu_ping", "ping"),
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "tool_use" } },
      { type: "message_stop" },
    ]);
    const calls = chunks.flatMap((chunk) => chunk.choices?.[0]?.delta?.tool_calls || []);
    expect(calls).toEqual([
      { index: 0, id: "toolu_ping", type: "function", function: { name: "ping", arguments: "" } },
    ]);
    expect(chunks.at(-1).choices[0].finish_reason).toBe("tool_calls");
  });

  it("keeps both IDs and complete arguments through the Responses pivot", () => {
    const events = translate(toolStream(), FORMATS.OPENAI_RESPONSES).map((event) => event.data);
    const completedCalls = events
      .filter((event) => event.type === "response.output_item.done" && event.item.type === "function_call")
      .map((event) => ({ call_id: event.item.call_id, name: event.item.name, arguments: event.item.arguments }));
    expect(completedCalls).toEqual([
      { call_id: "toolu_paris", name: "get_weather", arguments: '{"city":"Paris"}' },
      { call_id: "toolu_seoul", name: "get_weather", arguments: '{"city":"Seoul"}' },
    ]);
  });
});
