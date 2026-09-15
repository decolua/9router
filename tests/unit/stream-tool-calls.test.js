import { describe, expect, it } from "vitest";

import { createPassthroughStreamWithLogger, createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// A turn that only calls tools has no assistant text, so the request log used to report
// it as "[Empty streaming response]" — indistinguishable from an upstream that returned
// nothing. That made real truncations impossible to tell apart from ordinary tool use
// (284 such rows in one user's database), so tool calls must be captured.
function body(chunks) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

const delta = (payload) => `data: ${JSON.stringify(payload)}\n\n`;
const toolDelta = (call) => delta({ choices: [{ index: 0, delta: { tool_calls: [call] }, finish_reason: null }] });
const FINISH = delta({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });

async function collect(input, stream) {
  let captured = null;
  const withCapture = stream((contentObj) => { captured = contentObj; });
  const reader = body(input).pipeThrough(withCapture).getReader();
  for (;;) {
    const { done } = await reader.read();
    if (done) break;
  }
  return captured;
}

const passthrough = (onStreamComplete) => createPassthroughStreamWithLogger("deepseek", null, "m", null, { messages: [] }, onStreamComplete, null, FORMATS.OPENAI);
const translate = (onStreamComplete) => createSSETransformStreamWithLogger(FORMATS.COMMANDCODE, FORMATS.OPENAI, "commandcode", null, null, "m", null, { messages: [] }, onStreamComplete);

// One tool call split across fragments, the way OpenAI-shaped providers stream it.
const FRAGMENTS = [
  toolDelta({ index: 0, id: "call_1", function: { name: "get_weather", arguments: '{"ci' } }),
  toolDelta({ index: 0, function: { arguments: 'ty":"Paris"}' } }),
  FINISH,
];

const EXPECTED = [{ id: "call_1", name: "get_weather", arguments: '{"city":"Paris"}' }];

describe("tool calls reach the request log", () => {
  it("passthrough: reassembles fragments into one call", async () => {
    const captured = await collect(FRAGMENTS, passthrough);
    expect(captured.toolCalls).toEqual(EXPECTED);
    expect(captured.content).toBe("");
  });

  it("translate: reassembles fragments into one call", async () => {
    const captured = await collect(FRAGMENTS, translate);
    expect(captured.toolCalls).toEqual(EXPECTED);
    expect(captured.content).toBe("");
  });

  it("passthrough: keeps parallel calls apart by index", async () => {
    const captured = await collect([
      toolDelta({ index: 0, id: "call_a", function: { name: "read", arguments: "{}" } }),
      toolDelta({ index: 1, id: "call_b", function: { name: "write", arguments: "{}" } }),
      FINISH,
    ], passthrough);
    expect(captured.toolCalls.map((c) => c.name)).toEqual(["read", "write"]);
  });

  it("reports no tool calls for a plain text reply", async () => {
    const captured = await collect([
      delta({ choices: [{ index: 0, delta: { content: "hi" }, finish_reason: null }] }),
      delta({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }),
    ], passthrough);
    expect(captured.toolCalls).toEqual([]);
    expect(captured.content).toBe("hi");
  });

  it("associates arguments with the right name when the header arrives first", async () => {
    // The Claude shape splits the tool header from its JSON arguments.
    const captured = await collect([
      "data: {\"type\":\"content_block_start\",\"index\":1,\"content_block\":{\"type\":\"tool_use\",\"id\":\"tu_1\",\"name\":\"search\"}}\n\n",
      "data: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"q\\\":\"}}\n\n",
      "data: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"\\\"cats\\\"}\"}}\n\n",
    ], (cb) => createSSETransformStreamWithLogger(FORMATS.CLAUDE, FORMATS.OPENAI, "claude", null, null, "m", null, { messages: [] }, cb));
    expect(captured.toolCalls).toEqual([{ id: "tu_1", name: "search", arguments: '{"q":"cats"}' }]);
  });
});
