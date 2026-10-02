import { describe, expect, it } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { initState } from "../../open-sse/translator/index.js";
import { openaiToOpenAIResponsesResponse } from "../../open-sse/translator/response/openai-responses.js";

// The fork completes on flush on both direct and pivot routes, preserving trailing usage.
function newState() {
  return { ...initState(FORMATS.OPENAI_RESPONSES), targetFormat: FORMATS.OPENAI };
}

function textChunk(text, index = 0) {
  return { id: "chatcmpl-1", choices: [{ index, delta: { content: text } }] };
}

function reasoningChunk(text, index = 0) {
  return { id: "chatcmpl-1", choices: [{ index, delta: { reasoning_content: text } }] };
}

function finishChunk(usage) {
  return { id: "chatcmpl-1", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage };
}

function runChunks(chunks) {
  const state = newState();
  const events = [];
  for (const chunk of chunks) {
    for (const event of openaiToOpenAIResponsesResponse(chunk, state)) events.push(event);
  }
  if (chunks.some(chunk => chunk?.choices?.some(choice => choice.finish_reason))) {
    events.push(...openaiToOpenAIResponsesResponse(null, state));
  }
  return { state, events };
}

function completedResponse(events) {
  const completed = events.find((event) => event.event === "response.completed");
  expect(completed, "expected a response.completed event").toBeTruthy();
  return completed.data.response;
}

function doneItems(events) {
  return events
    .filter((event) => event.event === "response.output_item.done")
    .map((event) => event.data.item);
}

describe("response.completed output (issue #4307)", () => {
  // The regression: sendCompleted() built the response object without an `output`
  // key at all, so response.completed arrived with no output even though the
  // message had already been streamed. Clients that build the final result from
  // the terminal event (GitHub Copilot CLI 1.0.89 with a BYOK provider) printed
  // the text and then failed with "No response was returned".
  it("repeats the streamed message in response.completed", () => {
    const state = newState();
    openaiToOpenAIResponsesResponse(textChunk("O"), state);
    openaiToOpenAIResponsesResponse(textChunk("K"), state);
    const response = completedResponse(openaiToOpenAIResponsesResponse(null, state));

    expect(response.status).toBe("completed");
    expect(Array.isArray(response.output)).toBe(true);
    expect(response.output).toHaveLength(1);
    expect(response.output[0]).toMatchObject({ type: "message", role: "assistant" });
    expect(response.output[0].content[0]).toMatchObject({ type: "output_text", text: "OK" });
  });

  it("matches exactly the items already delivered in response.output_item.done", () => {
    const { events } = runChunks([
      textChunk("hello"),
      finishChunk({ prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 }),
    ]);
    const response = completedResponse(events);
    const streamed = doneItems(events);

    expect(streamed).toHaveLength(1);
    expect(response.output).toEqual(streamed);
  });

  it("includes a function_call item", () => {
    const { events } = runChunks([
      {
        id: "chatcmpl-1",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 0, id: "call_1", function: { name: "get_weather", arguments: '{"city":"Paris"}' } },
              ],
            },
          },
        ],
      },
      finishChunk({ prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }),
    ]);
    const response = completedResponse(events);

    expect(response.output).toHaveLength(1);
    expect(response.output[0]).toMatchObject({
      type: "function_call",
      name: "get_weather",
      arguments: '{"city":"Paris"}',
      call_id: "call_1",
    });
  });

  it("orders output by output_index", () => {
    const { events } = runChunks([
      reasoningChunk("thinking", 0),
      textChunk("answer", 1),
      finishChunk({ prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 }),
    ]);
    const response = completedResponse(events);

    expect(response.output.map((item) => item.type)).toEqual(["reasoning", "message"]);
    expect(response.output[1].content[0]).toMatchObject({ type: "output_text", text: "answer" });
  });

  it("reports an empty output array when nothing was produced", () => {
    const state = newState();
    const response = completedResponse(openaiToOpenAIResponsesResponse(null, state));
    expect(response.output).toEqual([]);
  });

  it("keeps the usage block alongside output", () => {
    const { events } = runChunks([
      textChunk("OK"),
      finishChunk({ prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 }),
    ]);
    const response = completedResponse(events);

    expect(response.usage).toMatchObject({ input_tokens: 3, output_tokens: 1, total_tokens: 4 });
    expect(response.output).toHaveLength(1);
  });

  it("leaves the in-progress response.created output empty", () => {
    const { events } = runChunks([textChunk("hi")]);
    const created = events.find((event) => event.event === "response.created");
    expect(created.data.response.status).toBe("in_progress");
    expect(created.data.response.output).toEqual([]);
  });

  it("does not duplicate items when flush runs more than once", () => {
    const state = newState();
    openaiToOpenAIResponsesResponse(textChunk("once"), state);
    openaiToOpenAIResponsesResponse(null, state);
    const second = openaiToOpenAIResponsesResponse(null, state);

    expect(second).toEqual([]);
    expect(state.completedOutputItems.size).toBe(1);
  });

  it("retains reasoning, text, and namespaced tools sharing Chat index zero", () => {
    const state = newState();
    state.toolNamespaces = new Map([["exec", "functions"]]);
    const chunks = [
      reasoningChunk("Check the file"),
      textChunk("Reading it now"),
      { choices: [{ index: 0, delta: { tool_calls: [
        { index: 0, id: "call_1", function: { name: "exec", arguments: '{"cmd":"pwd"}' } },
      ] } }] },
      finishChunk(),
      { choices: [], usage: { prompt_tokens: 11, completion_tokens: 7 } },
      null,
    ];
    const events = chunks.flatMap(chunk => openaiToOpenAIResponsesResponse(chunk, state));
    const response = completedResponse(events);
    expect(response.output.map(item => item.type)).toEqual(["reasoning", "message", "function_call"]);
    expect(response.output).toEqual(doneItems(events));
    expect(response.output[2]).toMatchObject({ namespace: "functions", call_id: "call_1" });
    expect(events.filter(e => e.event === "response.output_item.added").map(e => e.data.output_index)).toEqual([0, 1, 2]);
    expect(response.usage).toMatchObject({ input_tokens: 11, output_tokens: 7 });
  });

  it("preserves output on an incomplete terminal response", () => {
    const state = newState();
    openaiToOpenAIResponsesResponse(textChunk("Partial answer"), state);
    openaiToOpenAIResponsesResponse({ choices: [{ index: 0, delta: {}, finish_reason: "length" }] }, state);
    const events = openaiToOpenAIResponsesResponse(null, state);
    const terminal = events.find(e => e.event === "response.incomplete");
    expect(terminal.data.response.output[0].content[0].text).toBe("Partial answer");
    expect(terminal.data.response.incomplete_details.reason).toBe("max_output_tokens");
  });
});
