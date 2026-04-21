import { describe, it, expect } from "vitest";
import { createResponsesApiTransformStream } from "../../open-sse/transformer/responsesTransformer.js";
import { openaiToOpenAIResponsesResponse } from "../../open-sse/translator/response/openai-responses.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function chatChunk({ id = "chatcmpl-test", index = 0, delta = {}, finish_reason = null }) {
  return {
    id,
    choices: [{ index, delta, finish_reason }],
  };
}

function sseData(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function parseSseEvents(raw) {
  return raw
    .split("\n\n")
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const event = block.match(/^event:\s*(.+)$/m)?.[1] ?? null;
      const dataLine = block.match(/^data:\s*(.+)$/m)?.[1] ?? "";
      if (dataLine === "[DONE]") {
        return { event: "done", data: "[DONE]" };
      }
      return { event, data: JSON.parse(dataLine) };
    });
}

async function collectTransformerEvents(chunks) {
  const source = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  const reader = source.pipeThrough(createResponsesApiTransformStream()).getReader();
  let raw = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    raw += decoder.decode(value, { stream: true });
  }

  raw += decoder.decode();
  return parseSseEvents(raw);
}

function createTranslatorState() {
  return {
    seq: 0,
    responseId: "resp_seed",
    created: 1700000000,
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
    funcArgsDone: {},
    funcItemDone: {},
    completedSent: false,
  };
}

function collectTranslatorEvents(chunks) {
  const state = createTranslatorState();
  const events = [];

  for (const chunk of chunks) {
    events.push(...openaiToOpenAIResponsesResponse(chunk, state));
  }

  return events;
}

function completedResponse(events) {
  const completedEvent = events.find(({ event }) => event === "response.completed");
  expect(completedEvent, "response.completed event must exist").toBeDefined();
  return completedEvent.data.response;
}

function normalizeOutputItem(item) {
  if (item.type === "message") {
    return {
      type: item.type,
      role: item.role,
      content: (item.content ?? []).map((part) => ({
        type: part.type,
        text: part.text,
      })),
    };
  }

  if (item.type === "reasoning") {
    return {
      type: item.type,
      summary: (item.summary ?? []).map((part) => ({
        type: part.type,
        text: part.text,
      })),
    };
  }

  if (item.type === "function_call") {
    return {
      type: item.type,
      call_id: item.call_id,
      name: item.name,
      arguments: item.arguments,
    };
  }

  return item;
}

function normalizedFinalizedOutput(events) {
  return events
    .filter(({ event }) => event === "response.output_item.done")
    .map(({ data }) => normalizeOutputItem(data.item));
}

function expectCompletedOutputToMatchFinalized(events) {
  const finalizedOutput = normalizedFinalizedOutput(events);
  const response = completedResponse(events);
  expect(response).toHaveProperty("output");
  expect((response.output ?? []).map(normalizeOutputItem)).toEqual(finalizedOutput);
}

describe("Responses output contract", () => {
  it("transformer includes finalized message output on response.completed", async () => {
    const events = await collectTransformerEvents([
      sseData(chatChunk({ id: "chatcmpl-msg", index: 0, delta: { content: "Hello from 9router" } })),
      sseData(chatChunk({ id: "chatcmpl-msg", index: 0, delta: {}, finish_reason: "stop" })),
      "data: [DONE]\n\n",
    ]);

    expect(normalizedFinalizedOutput(events)).toEqual([
      {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: "Hello from 9router",
          },
        ],
      },
    ]);
    expectCompletedOutputToMatchFinalized(events);
  });

  it("transformer emits output: [] when no items finalize", async () => {
    const events = await collectTransformerEvents([
      sseData(chatChunk({ id: "chatcmpl-empty", index: 0, delta: {}, finish_reason: "stop" })),
      "data: [DONE]\n\n",
    ]);

    expect(normalizedFinalizedOutput(events)).toEqual([]);
    expectCompletedOutputToMatchFinalized(events);
  });

  it("transformer mirrors finalized multi-item output on response.completed", async () => {
    const events = await collectTransformerEvents([
      sseData(chatChunk({ id: "chatcmpl-order", index: 0, delta: { reasoning_content: "Check constraints." } })),
      sseData(chatChunk({ id: "chatcmpl-order", index: 2, delta: { content: "Proceed." } })),
      sseData(chatChunk({ id: "chatcmpl-order", index: 2, delta: {}, finish_reason: "stop" })),
      "data: [DONE]\n\n",
    ]);

    const finalizedOutput = normalizedFinalizedOutput(events);
    expect(finalizedOutput).toHaveLength(2);
    expect(finalizedOutput).toEqual(
      expect.arrayContaining([
        {
          type: "reasoning",
          summary: [{ type: "summary_text", text: "Check constraints." }],
        },
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Proceed." }],
        },
      ])
    );
    expectCompletedOutputToMatchFinalized(events);
  });

  it("transformer preserves function_call essentials in final output", async () => {
    const events = await collectTransformerEvents([
      sseData(
        chatChunk({
          id: "chatcmpl-tool",
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 3,
                id: "call_lookup_1",
                function: {
                  name: "lookupWeather",
                  arguments: '{"city":"London"}',
                },
              },
            ],
          },
        })
      ),
      sseData(chatChunk({ id: "chatcmpl-tool", index: 0, delta: {}, finish_reason: "tool_calls" })),
      "data: [DONE]\n\n",
    ]);

    expect(normalizedFinalizedOutput(events)).toEqual([
      {
        type: "function_call",
        call_id: "call_lookup_1",
        name: "lookupWeather",
        arguments: '{"city":"London"}',
      },
    ]);
    expectCompletedOutputToMatchFinalized(events);
  });

  it("translator includes finalized message output on response.completed", () => {
    const events = collectTranslatorEvents([
      chatChunk({ id: "chatcmpl-translator-msg", index: 0, delta: { content: "Translator online" } }),
      chatChunk({ id: "chatcmpl-translator-msg", index: 0, delta: {}, finish_reason: "stop" }),
    ]);

    expect(normalizedFinalizedOutput(events)).toEqual([
      {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: "Translator online",
          },
        ],
      },
    ]);
    expectCompletedOutputToMatchFinalized(events);
  });

  it("translator emits output: [] when no items finalize", () => {
    const events = collectTranslatorEvents([
      chatChunk({ id: "chatcmpl-translator-empty", index: 0, delta: {}, finish_reason: "stop" }),
    ]);

    expect(normalizedFinalizedOutput(events)).toEqual([]);
    expectCompletedOutputToMatchFinalized(events);
  });

  it("translator mirrors finalized multi-item output on response.completed", () => {
    const events = collectTranslatorEvents([
      chatChunk({ id: "chatcmpl-translator-order", index: 0, delta: { reasoning_content: "Plan first." } }),
      chatChunk({ id: "chatcmpl-translator-order", index: 2, delta: { content: "Then ship." } }),
      chatChunk({ id: "chatcmpl-translator-order", index: 2, delta: {}, finish_reason: "stop" }),
    ]);

    const finalizedOutput = normalizedFinalizedOutput(events);
    expect(finalizedOutput).toHaveLength(2);
    expect(finalizedOutput).toEqual(
      expect.arrayContaining([
        {
          type: "reasoning",
          summary: [{ type: "summary_text", text: "Plan first." }],
        },
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Then ship." }],
        },
      ])
    );
    expectCompletedOutputToMatchFinalized(events);
  });

  it("translator preserves function_call essentials in final output", () => {
    const events = collectTranslatorEvents([
      chatChunk({
        id: "chatcmpl-translator-tool",
        index: 0,
        delta: {
          tool_calls: [
            {
              index: 3,
              id: "call_lookup_2",
              function: {
                name: "lookupWeather",
                arguments: '{"city":"Paris"}',
              },
            },
          ],
        },
      }),
      chatChunk({ id: "chatcmpl-translator-tool", index: 0, delta: {}, finish_reason: "tool_calls" }),
    ]);

    expect(normalizedFinalizedOutput(events)).toEqual([
      {
        type: "function_call",
        call_id: "call_lookup_2",
        name: "lookupWeather",
        arguments: '{"city":"Paris"}',
      },
    ]);
    expectCompletedOutputToMatchFinalized(events);
  });
});
