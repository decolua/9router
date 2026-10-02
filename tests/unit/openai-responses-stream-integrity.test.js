import { describe, expect, it } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSEStream } from "../../open-sse/utils/stream.js";
import { convertResponsesStreamToJson } from "../../open-sse/transformer/streamToJsonConverter.js";

const encoder = new TextEncoder();

function chatChunk(delta, finishReason = null) {
  return {
    id: "chatcmpl_stream_integrity",
    object: "chat.completion.chunk",
    created: 1,
    model: "test-model",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

async function translateChatStream(chunks, customToolNames = []) {
  const upstream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      }
      controller.close();
    },
  });

  const downstream = upstream.pipeThrough(createSSEStream({
    mode: "translate",
    targetFormat: FORMATS.OPENAI,
    sourceFormat: FORMATS.OPENAI_RESPONSES,
    provider: "test-provider",
    model: "test-model",
    customToolNames,
  }));
  const wire = await new Response(downstream).text();
  const events = wire.split("\n\n")
    .filter((block) => block.startsWith("event: "))
    .map((block) => {
      const event = block.match(/^event: (.+)$/m)?.[1];
      const data = JSON.parse(block.match(/^data: (.+)$/m)?.[1]);
      return { event, data };
    });
  return { wire, events };
}

const terminalEvents = (events) => events.filter(({ event }) =>
  event === "response.completed" ||
  event === "response.incomplete" ||
  event === "response.failed"
);

describe("Chat SSE to Responses stream integrity", () => {
  it("fails a reasoning-only stream that reaches EOF without a finish marker", async () => {
    const { events } = await translateChatStream([
      chatChunk({ reasoning_content: "thinking" }),
    ]);

    expect(events.some(({ event, data }) =>
      event === "response.output_item.done" && data.item.type === "reasoning"
    )).toBe(true);
    expect(terminalEvents(events).map(({ event }) => event)).toEqual(["response.failed"]);
    expect(terminalEvents(events)[0].data.response).toMatchObject({
      id: events.find(({ event }) => event === "response.created").data.response.id,
      status: "failed",
    });
  });

  it("marks finish_reason length as incomplete rather than completed", async () => {
    const { events } = await translateChatStream([
      chatChunk({ reasoning_content: "thinking" }),
      chatChunk({}, "length"),
    ]);

    expect(terminalEvents(events).map(({ event }) => event)).toEqual(["response.incomplete"]);
    expect(terminalEvents(events)[0].data.response).toMatchObject({
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
    });
  });

  it("fails an explicit stop when the stream has only reasoning", async () => {
    const { events } = await translateChatStream([
      chatChunk({ reasoning_content: "thinking" }),
      chatChunk({}, "stop"),
    ]);

    expect(terminalEvents(events).map(({ event }) => event)).toEqual(["response.failed"]);
    expect(terminalEvents(events)[0].data.response).toMatchObject({
      status: "failed",
      error: { code: "empty_output" },
    });
  });

  it("fails an explicit tool_calls finish when the stream has only reasoning", async () => {
    const { events } = await translateChatStream([
      chatChunk({ reasoning_content: "thinking" }),
      chatChunk({}, "tool_calls"),
    ]);

    expect(terminalEvents(events).map(({ event }) => event)).toEqual(["response.failed"]);
    expect(terminalEvents(events)[0].data.response).toMatchObject({
      status: "failed",
      error: { code: "empty_output" },
    });
  });

  it.each([
    ["a blank name", { index: 0, id: "call_bad", type: "function", function: { name: "", arguments: "{}" } }],
    ["a missing call ID", { index: 0, type: "function", function: { name: "lookup", arguments: "{}" } }],
  ])("fails a mixed Chat stream containing a tool call with %s", async (_case, badCall) => {
    const { events } = await translateChatStream([
      chatChunk({ content: "answer" }),
      chatChunk({ tool_calls: [badCall] }),
      chatChunk({}, "stop"),
    ]);

    expect(terminalEvents(events).map(({ event }) => event)).toEqual(["response.failed"]);
    expect(terminalEvents(events)[0].data.response.error.code).toBe("invalid_tool_call");
  });

  it("recognizes an explicit stop on tagged reasoning as empty output", async () => {
    const { events } = await translateChatStream([
      chatChunk({ content: "<think>thinking" }, "stop"),
    ]);

    expect(terminalEvents(events).map(({ event }) => event)).toEqual(["response.failed"]);
    expect(terminalEvents(events)[0].data.response.error.code).toBe("empty_output");
  });

  it("marks finish_reason content_filter as incomplete", async () => {
    const { events } = await translateChatStream([
      chatChunk({ reasoning_content: "thinking" }),
      chatChunk({}, "content_filter"),
    ]);

    expect(terminalEvents(events).map(({ event }) => event)).toEqual(["response.incomplete"]);
    expect(terminalEvents(events)[0].data.response).toMatchObject({
      status: "incomplete",
      incomplete_details: { reason: "content_filter" },
    });
  });

  it("fails an unsupported Chat finish reason even when answer text exists", async () => {
    const { events } = await translateChatStream([
      chatChunk({ content: "partial answer" }),
      chatChunk({}, "unexpected"),
    ]);

    expect(terminalEvents(events).map(({ event }) => event)).toEqual(["response.failed"]);
    expect(terminalEvents(events)[0].data.response.error.code).toBe("invalid_finish_reason");
  });

  it("accepts a provider's other finish when it carries a complete tool call", async () => {
    const { events } = await translateChatStream([
      chatChunk({ tool_calls: [{
        index: 0,
        id: "call_1",
        type: "function",
        function: { name: "search", arguments: '{"q":"hello"}' },
      }] }),
      chatChunk({}, "other"),
    ]);

    expect(terminalEvents(events).map(({ event }) => event)).toEqual(["response.completed"]);
    expect(events.find(({ event }) => event === "response.output_item.done").data.item.name).toBe("search");
  });

  it("emits a Responses refusal item for streamed Chat refusal deltas", async () => {
    const { wire, events } = await translateChatStream([
      chatChunk({ refusal: "I cannot " }),
      chatChunk({ refusal: "help with that." }, "stop"),
    ]);

    expect(terminalEvents(events).map(({ event }) => event)).toEqual(["response.completed"]);
    expect(events
      .filter(({ event }) => event === "response.refusal.delta")
      .map(({ data }) => data.delta).join("")).toBe("I cannot help with that.");
    expect(events.some(({ event }) => event === "response.output_text.delta")).toBe(false);
    expect(events.find(({ event }) => event === "response.output_item.done").data.item).toMatchObject({
      type: "message",
      content: [{ type: "refusal", refusal: "I cannot help with that." }],
    });

    const assembled = await convertResponsesStreamToJson(new Response(wire).body);
    expect(assembled.status).toBe("completed");
    expect(assembled.output[0].content[0]).toEqual({
      type: "refusal",
      refusal: "I cannot help with that.",
    });
  });

  it("preserves reasoning, answer text, and parallel tool calls at stable distinct output indices", async () => {
    const searchArgs = '{"q":"ok"}';
    const customArgs = '{"input":"return 1;"}';
    const { wire, events } = await translateChatStream([
      chatChunk({ reasoning_content: "thinking" }),
      chatChunk({ content: "final answer" }),
      chatChunk({ tool_calls: [
        { index: 0, id: "call_search", type: "function", function: { name: "search", arguments: searchArgs } },
        { index: 1, id: "call_exec", type: "function", function: { name: "exec", arguments: customArgs } },
      ] }),
      chatChunk({}, "tool_calls"),
    ], ["exec"]);

    const added = events.filter(({ event }) => event === "response.output_item.added");
    expect(added.map(({ data }) => [data.item.type, data.output_index])).toEqual([
      ["reasoning", 0],
      ["message", 1],
      ["function_call", 2],
      ["custom_tool_call", 3],
    ]);
    const indexById = new Map(added.map(({ data }) => [data.item.id, data.output_index]));
    for (const { data } of events) {
      const itemId = data.item_id || data.item?.id;
      if (itemId && data.output_index !== undefined) {
        expect(data.output_index).toBe(indexById.get(itemId));
      }
    }
    expect(events
      .filter(({ event }) => event === "response.output_item.added" || event === "response.output_item.done")
      .map(({ event, data }) => [event, data.output_index])).toEqual([
        ["response.output_item.added", 0],
        ["response.output_item.done", 0],
        ["response.output_item.added", 1],
        ["response.output_item.done", 1],
        ["response.output_item.added", 2],
        ["response.output_item.added", 3],
        ["response.output_item.done", 2],
        ["response.output_item.done", 3],
      ]);

    const assembled = await convertResponsesStreamToJson(new Response(wire).body);
    expect(assembled.status).toBe("completed");
    expect(assembled.output.map((item) => item.type)).toEqual([
      "reasoning", "message", "function_call", "custom_tool_call",
    ]);
    expect(assembled.output[1].content[0].text).toBe("final answer");
    expect(assembled.output[2].arguments).toBe(searchArgs);
    expect(assembled.output[3].input).toBe("return 1;");
    expect(terminalEvents(events).map(({ event }) => event)).toEqual(["response.completed"]);
  });

  it("closes parallel tool calls in output order when their Chat indices arrive reversed", async () => {
    const { events } = await translateChatStream([
      chatChunk({ tool_calls: [
        { index: 1, id: "call_second", type: "function", function: { name: "second", arguments: "{}" } },
        { index: 0, id: "call_first", type: "function", function: { name: "first", arguments: "{}" } },
      ] }),
      chatChunk({}, "tool_calls"),
    ]);

    const toolItems = events.filter(({ event }) =>
      event === "response.output_item.added" || event === "response.output_item.done"
    );
    expect(toolItems.map(({ event, data }) => [event, data.output_index])).toEqual([
      ["response.output_item.added", 0],
      ["response.output_item.added", 1],
      ["response.output_item.done", 0],
      ["response.output_item.done", 1],
    ]);
    expect(terminalEvents(events).map(({ event }) => event)).toEqual(["response.completed"]);
  });

  it("closes reasoning before adding a tool call when there is no answer text", async () => {
    const { events } = await translateChatStream([
      chatChunk({ reasoning_content: "thinking" }),
      chatChunk({ tool_calls: [
        { index: 0, id: "call_search", type: "function", function: { name: "search", arguments: "{}" } },
      ] }),
      chatChunk({}, "tool_calls"),
    ]);

    expect(events
      .filter(({ event }) => event === "response.output_item.added" || event === "response.output_item.done")
      .map(({ event, data }) => [event, data.output_index])).toEqual([
        ["response.output_item.added", 0],
        ["response.output_item.done", 0],
        ["response.output_item.added", 1],
        ["response.output_item.done", 1],
      ]);
  });

  it("does not close an ID-only partial tool call that was never announced", async () => {
    const { events } = await translateChatStream([
      chatChunk({ tool_calls: [
        { index: 0, id: "call_partial", type: "function", function: { arguments: '{"x":' } },
      ] }),
      chatChunk({}, "tool_calls"),
    ]);

    expect(events.filter(({ event }) =>
      event === "response.output_item.added" ||
      event === "response.output_item.done" ||
      event === "response.function_call_arguments.done"
    )).toEqual([]);
    expect(terminalEvents(events).map(({ event }) => event)).toEqual(["response.failed"]);
    expect(terminalEvents(events)[0].data.response.error.code).toBe("empty_output");
  });

  it("does not count a blank tool name as a usable call", async () => {
    const { events } = await translateChatStream([
      chatChunk({ tool_calls: [
        { index: 0, id: "call_blank", type: "function", function: { name: " ", arguments: "{}" } },
      ] }),
      chatChunk({}, "tool_calls"),
    ]);

    expect(events.filter(({ event }) =>
      event === "response.output_item.added" || event === "response.output_item.done"
    )).toEqual([]);
    expect(terminalEvents(events).map(({ event }) => event)).toEqual(["response.failed"]);
    expect(terminalEvents(events)[0].data.response.error.code).toBe("empty_output");
  });

  it("opens new items when reasoning resumes after answer text", async () => {
    const { wire, events } = await translateChatStream([
      chatChunk({ reasoning_content: "first thought" }),
      chatChunk({ content: "draft" }),
      chatChunk({ reasoning_content: "second thought" }),
      chatChunk({ content: "final answer" }),
      chatChunk({}, "stop"),
    ]);

    const itemEvents = events.filter(({ event }) =>
      event === "response.output_item.added" || event === "response.output_item.done"
    );
    expect(itemEvents.map(({ event, data }) => [event, data.output_index, data.item.type])).toEqual([
      ["response.output_item.added", 0, "reasoning"],
      ["response.output_item.done", 0, "reasoning"],
      ["response.output_item.added", 1, "message"],
      ["response.output_item.done", 1, "message"],
      ["response.output_item.added", 2, "reasoning"],
      ["response.output_item.done", 2, "reasoning"],
      ["response.output_item.added", 3, "message"],
      ["response.output_item.done", 3, "message"],
    ]);
    const reasoningAdded = itemEvents.filter(({ event, data }) =>
      event === "response.output_item.added" && data.item.type === "reasoning"
    );
    expect(new Set(reasoningAdded.map(({ data }) => data.item.id)).size).toBe(2);
    for (const { data } of events.filter(({ event }) => event === "response.reasoning_summary_text.delta")) {
      const addedAt = events.findIndex(({ event, data: item }) =>
        event === "response.output_item.added" && item.item.id === data.item_id
      );
      const doneAt = events.findIndex(({ event, data: item }) =>
        event === "response.output_item.done" && item.item.id === data.item_id
      );
      const deltaAt = events.findIndex(({ data: item }) => item === data);
      expect(addedAt).toBeLessThan(deltaAt);
      expect(deltaAt).toBeLessThan(doneAt);
    }

    const assembled = await convertResponsesStreamToJson(new Response(wire).body);
    expect(assembled.output.map((item) => item.type)).toEqual([
      "reasoning", "message", "reasoning", "message",
    ]);
    expect(assembled.output[1].content[0].text).toBe("draft");
    expect(assembled.output[3].content[0].text).toBe("final answer");
    expect(terminalEvents(events).map(({ event }) => event)).toEqual(["response.completed"]);
  });
});
