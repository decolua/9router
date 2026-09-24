import { describe, expect, it } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { initState, translateResponse } from "../../open-sse/translator/index.js";
import { createResponsesApiTransformStream } from "../../open-sse/transformer/responsesTransformer.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";

function chatChunk(delta, finishReason = null) {
  return {
    id: "chatcmpl-fable-index",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

function translateChatStream(chunks) {
  const state = initState(FORMATS.OPENAI_RESPONSES);
  return chunks.flatMap((chunk) => translateResponse(
    FORMATS.OPENAI,
    FORMATS.OPENAI_RESPONSES,
    chunk,
    state,
  ));
}

async function translateProductionStream(chunks) {
  const wire = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";
  const source = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      for (let offset = 0; offset < wire.length; offset += 37) {
        controller.enqueue(encoder.encode(wire.slice(offset, offset + 37)));
      }
      controller.close();
    },
  });
  const output = source.pipeThrough(createSSETransformStreamWithLogger(
    FORMATS.OPENAI,
    FORMATS.OPENAI_RESPONSES,
    "github",
  ));
  return new Response(output).text();
}

async function translateLegacyStream(chunks) {
  const wire = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("");
  const source = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(wire));
      controller.close();
    },
  });
  return new Response(source.pipeThrough(createResponsesApiTransformStream())).text();
}

function parseWireEvents(text) {
  return text
    .split("\n\n")
    .map((block) => {
      const event = block.match(/^event:\s*(.+)$/m)?.[1];
      const data = block.match(/^data:\s*(.+)$/m)?.[1];
      if (!event || !data || data === "[DONE]") return null;
      return { event, data: JSON.parse(data) };
    })
    .filter(Boolean);
}

describe("Chat-to-Responses output item indexes", () => {
  it("keeps reasoning, text, and fragmented function calls on distinct stable indexes", () => {
    const events = translateChatStream([
      chatChunk({ reasoning_content: "planning" }),
      chatChunk({ content: "Working" }),
      chatChunk({
        tool_calls: [
          {
            index: 0,
            id: "call_first",
            type: "function",
            function: { name: "first_tool", arguments: '{"value":' },
          },
          {
            index: 1,
            id: "call_second",
            type: "function",
            function: { name: "second_tool", arguments: '{"value":' },
          },
        ],
      }),
      chatChunk({
        tool_calls: [
          { index: 0, function: { arguments: "1}" } },
          { index: 1, function: { arguments: "2}" } },
        ],
      }, "tool_calls"),
    ]);
    const added = events
      .filter(({ event }) => event === "response.output_item.added")
      .map(({ data }) => ({ type: data.item.type, index: data.output_index }));

    expect(added).toEqual([
      { type: "reasoning", index: 0 },
      { type: "message", index: 1 },
      { type: "function_call", index: 2 },
      { type: "function_call", index: 3 },
    ]);

    const expectedIndexes = new Map(events
      .filter(({ event }) => event === "response.output_item.added")
      .map(({ data }) => [data.item.id, data.output_index]));
    for (const [itemId, expectedIndex] of expectedIndexes) {
      const indexes = events
        .filter(({ data }) => data.item_id === itemId || data.item?.id === itemId)
        .map(({ data }) => data.output_index);
      expect(new Set(indexes)).toEqual(new Set([expectedIndex]));
    }

    expect(events.map(({ data }) => data.sequence_number)).toEqual(
      events.map((_, index) => index + 1),
    );
  });

  it("preserves unique indexes through the production SSE pipeline", async () => {
    const text = await translateProductionStream([
      chatChunk({ reasoning_content: "planning" }),
      chatChunk({
        tool_calls: [{
          index: 0,
          id: "call_probe",
          type: "function",
          function: { name: "echo_probe", arguments: '{"text":"probe"}' },
        }],
      }),
      chatChunk({}),
    ]);
    const events = parseWireEvents(text);
    const added = events
      .filter(({ event }) => event === "response.output_item.added")
      .map(({ data }) => ({ type: data.item.type, index: data.output_index }));

    expect(added).toEqual([
      { type: "reasoning", index: 0 },
      { type: "function_call", index: 1 },
    ]);
  });

  it("keeps the legacy transformer on the same unique-index contract", async () => {
    const text = await translateLegacyStream([
      chatChunk({ reasoning_content: "planning" }),
      chatChunk({ content: "Working" }),
      chatChunk({
        tool_calls: [
          {
            index: 0,
            id: "call_first",
            type: "function",
            function: { name: "first_tool", arguments: '{"value":' },
          },
          {
            index: 1,
            id: "call_second",
            type: "function",
            function: { name: "second_tool", arguments: '{"value":' },
          },
        ],
      }),
      chatChunk({
        tool_calls: [
          { index: 0, function: { arguments: "1}" } },
          { index: 1, function: { arguments: "2}" } },
        ],
      }, "tool_calls"),
    ]);
    const events = parseWireEvents(text);
    const added = events
      .filter(({ event }) => event === "response.output_item.added")
      .map(({ data }) => ({ type: data.item.type, index: data.output_index }));

    expect(added).toEqual([
      { type: "reasoning", index: 0 },
      { type: "message", index: 1 },
      { type: "function_call", index: 2 },
      { type: "function_call", index: 3 },
    ]);

    const expectedIndexes = new Map(events
      .filter(({ event }) => event === "response.output_item.added")
      .map(({ data }) => [data.item.id, data.output_index]));
    for (const [itemId, expectedIndex] of expectedIndexes) {
      const indexes = events
        .filter(({ data }) => data.item_id === itemId || data.item?.id === itemId)
        .map(({ data }) => data.output_index);
      expect(new Set(indexes)).toEqual(new Set([expectedIndex]));
    }
  });
});
