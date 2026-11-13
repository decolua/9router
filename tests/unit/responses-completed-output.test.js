/**
 * Regression test for #4307
 *
 * /v1/responses stream: response.completed carried output:[] even after output
 * items were streamed. Clients that build their final result from
 * response.completed (GitHub Copilot CLI, OpenAI SDK final-response helpers)
 * treated the turn as empty and printed "No response was returned".
 *
 * Fix: accumulate completed output items in state.outputItems and inject them
 * into response.completed.response.output sorted by output_index.
 */

import { describe, it, expect } from "vitest";
import { createResponsesApiTransformStream } from "../../open-sse/transformer/responsesTransformer.js";

/** Collect all SSE events emitted by the transform stream */
async function runTransform(inputChunks) {
  const stream = createResponsesApiTransformStream();
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();

  const events = [];
  const decoder = new TextDecoder();

  // Write all chunks then close
  (async () => {
    for (const chunk of inputChunks) {
      await writer.write(new TextEncoder().encode(chunk));
    }
    await writer.close();
  })();

  // Read all output
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value);
    // Parse individual SSE events
    for (const block of text.split("\n\n")) {
      const m = block.match(/^event:\s*(\S+)\ndata:\s*(.+)$/s);
      if (m) events.push({ type: m[1], data: JSON.parse(m[2]) });
    }
  }

  return events;
}

/** Build a minimal Chat Completions SSE stream with one text delta */
function makeTextStream(text) {
  const id = "chatcmpl-test001";
  return [
    `data: ${JSON.stringify({ id, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ id, choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ id, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`,
    `data: [DONE]\n\n`
  ];
}

/** Build a stream that emits a tool call */
function makeToolCallStream() {
  const id = "chatcmpl-tool001";
  return [
    `data: ${JSON.stringify({ id, choices: [{ index: 0, delta: { role: "assistant", content: null }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ id, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_abc", type: "function", function: { name: "search", arguments: "" } }] }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ id, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"q":"hi"}' } }] }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ id, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}\n\n`,
    `data: [DONE]\n\n`
  ];
}

describe("createResponsesApiTransformStream — response.completed output (#4307)", () => {
  it("includes the text message item in response.completed.output", async () => {
    const events = await runTransform(makeTextStream("Hello world"));

    const completed = events.find(e => e.type === "response.completed");
    expect(completed).toBeDefined();
    const output = completed.data.response.output;
    expect(Array.isArray(output)).toBe(true);
    expect(output.length).toBe(1);
    expect(output[0].type).toBe("message");
    expect(output[0].role).toBe("assistant");
    expect(output[0].content[0].text).toBe("Hello world");
  });

  it("includes the function_call item in response.completed.output", async () => {
    const events = await runTransform(makeToolCallStream());

    const completed = events.find(e => e.type === "response.completed");
    expect(completed).toBeDefined();
    const output = completed.data.response.output;
    expect(Array.isArray(output)).toBe(true);
    expect(output.length).toBe(1);
    expect(output[0].type).toBe("function_call");
    expect(output[0].name).toBe("search");
    expect(output[0].call_id).toBe("call_abc");
    expect(output[0].arguments).toBe('{"q":"hi"}');
  });

  it("output array matches the output_item.done items emitted during streaming", async () => {
    const events = await runTransform(makeTextStream("OK"));

    const donedItems = events
      .filter(e => e.type === "response.output_item.done")
      .map(e => e.data.item);

    const completed = events.find(e => e.type === "response.completed");
    const output = completed.data.response.output;

    expect(output).toEqual(donedItems);
  });
});