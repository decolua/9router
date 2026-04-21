import { describe, it, expect, afterEach, vi } from "vitest";
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Responses output contract", () => {
  it("transformer includes final message output on response.completed", async () => {
    const events = await collectTransformerEvents([
      sseData(chatChunk({ id: "chatcmpl-msg", index: 0, delta: { content: "Hello from 9router" } })),
      sseData(chatChunk({ id: "chatcmpl-msg", index: 0, delta: {}, finish_reason: "stop" })),
      "data: [DONE]\n\n",
    ]);

    const response = completedResponse(events);
    expect(response.output).toEqual([
      {
        id: "msg_resp_chatcmpl-msg_0",
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            annotations: [],
            logprobs: [],
            text: "Hello from 9router",
          },
        ],
      },
    ]);
  });

  it("transformer emits output: [] when no items finalize", async () => {
    const events = await collectTransformerEvents([
      sseData(chatChunk({ id: "chatcmpl-empty", index: 0, delta: {}, finish_reason: "stop" })),
      "data: [DONE]\n\n",
    ]);

    const response = completedResponse(events);
    expect(response.output).toEqual([]);
  });

  it("transformer preserves reasoning before assistant output and collapses sparse indexes", async () => {
    const events = await collectTransformerEvents([
      sseData(chatChunk({ id: "chatcmpl-order", index: 0, delta: { reasoning_content: "Check constraints." } })),
      sseData(chatChunk({ id: "chatcmpl-order", index: 2, delta: { content: "Proceed." } })),
      sseData(chatChunk({ id: "chatcmpl-order", index: 2, delta: {}, finish_reason: "stop" })),
      "data: [DONE]\n\n",
    ]);

    const response = completedResponse(events);
    expect(response.output).toHaveLength(2);
    expect(response.output.map((item) => item.type)).toEqual(["reasoning", "message"]);
    expect(response.output[0].summary[0].text).toBe("Check constraints.");
    expect(response.output[1].content[0].text).toBe("Proceed.");
  });

  it("transformer preserves function_call items in final output", async () => {
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

    const response = completedResponse(events);
    expect(response.output).toHaveLength(1);
    expect(response.output[0]).toEqual({
      id: "fc_call_lookup_1",
      type: "function_call",
      call_id: "call_lookup_1",
      name: "lookupWeather",
      arguments: '{"city":"London"}',
    });
  });

  it("translator includes final message output on response.completed", () => {
    const events = collectTranslatorEvents([
      chatChunk({ id: "chatcmpl-translator-msg", index: 0, delta: { content: "Translator online" } }),
      chatChunk({ id: "chatcmpl-translator-msg", index: 0, delta: {}, finish_reason: "stop" }),
    ]);

    const response = completedResponse(events);
    expect(response.output).toEqual([
      {
        id: "msg_resp_chatcmpl-translator-msg_0",
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            annotations: [],
            logprobs: [],
            text: "Translator online",
          },
        ],
      },
    ]);
  });

  it("translator emits output: [] when no items finalize", () => {
    const events = collectTranslatorEvents([
      chatChunk({ id: "chatcmpl-translator-empty", index: 0, delta: {}, finish_reason: "stop" }),
    ]);

    const response = completedResponse(events);
    expect(response.output).toEqual([]);
  });

  it("translator preserves reasoning/message order and collapses sparse indexes", () => {
    const events = collectTranslatorEvents([
      chatChunk({ id: "chatcmpl-translator-order", index: 0, delta: { reasoning_content: "Plan first." } }),
      chatChunk({ id: "chatcmpl-translator-order", index: 2, delta: { content: "Then ship." } }),
      chatChunk({ id: "chatcmpl-translator-order", index: 2, delta: {}, finish_reason: "stop" }),
    ]);

    const response = completedResponse(events);
    expect(response.output).toHaveLength(2);
    expect(response.output.map((item) => item.type)).toEqual(["reasoning", "message"]);
    expect(response.output[0].summary[0].text).toBe("Plan first.");
    expect(response.output[1].content[0].text).toBe("Then ship.");
  });
});
