/**
 * Some providers (e.g. codebuddy / cbcn) attach `tool_calls: []` to every
 * streaming chunk. An empty array is truthy in JS, so the guard
 * `if (delta.tool_calls)` closed the message on the first content token,
 * emitting `output_text.done` early and truncating the answer. This mirrors
 * the real repro: `codex exec -m cbcn/kimi-k3` answered only "cod" instead
 * of "codex-ok".
 */
import { describe, it, expect } from "vitest";
import { openaiToOpenAIResponsesResponse } from "../../open-sse/translator/response/openai-responses.js";
import { initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("OpenAI Chat stream → Responses: empty tool_calls arrays", () => {
  it("does not emit output_text.done early when every chunk carries tool_calls: []", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    const chunks = [
      { id: "cmb-test", choices: [{ index: 0, delta: { role: "assistant", content: "", reasoning_content: "", tool_calls: [] }, finish_reason: null }] },
      { id: "cmb-test", choices: [{ index: 0, delta: { content: "", reasoning_content: "thinking", tool_calls: [] }, finish_reason: null }] },
      { id: "cmb-test", choices: [{ index: 0, delta: { content: "cod", reasoning_content: "", tool_calls: [] }, finish_reason: null }] },
      { id: "cmb-test", choices: [{ index: 0, delta: { content: "ex", reasoning_content: "", tool_calls: [] }, finish_reason: null }] },
      { id: "cmb-test", choices: [{ index: 0, delta: { content: "-ok", reasoning_content: "", tool_calls: [] }, finish_reason: null }] },
      { id: "cmb-test", choices: [{ index: 0, delta: { content: "", reasoning_content: "", tool_calls: [] }, finish_reason: "stop" }] },
    ];

    const events = chunks.flatMap((chunk) => openaiToOpenAIResponsesResponse(chunk, state));
    // response.completed is deferred to flush so it can carry trailing usage
    events.push(...openaiToOpenAIResponsesResponse(null, state));
    const textDone = events.filter((e) => e.event === "response.output_text.done");
    const textDeltas = events.filter((e) => e.event === "response.output_text.delta");

    expect(textDone).toHaveLength(1);
    expect(textDone[0].data.text).toBe("codex-ok");
    expect(textDeltas.map((e) => e.data.delta).join("")).toBe("codex-ok");
    // done must come after every delta
    expect(events.indexOf(textDone[0])).toBe(events.indexOf(textDeltas[textDeltas.length - 1]) + 1);

    const created = events.find((e) => e.event === "response.created");
    const completed = events.find((e) => e.event === "response.completed");
    expect(created.data.response.model).toBe("unknown");
    expect(completed.data.response).toMatchObject({
      model: "unknown",
      status: "completed",
      incomplete_details: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
      },
    });
  });

  it("still closes the message before a real tool call", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    const chunks = [
      { id: "cmb-test", choices: [{ index: 0, delta: { content: "Let me run that.", tool_calls: [] }, finish_reason: null }] },
      { id: "cmb-test", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "exec", arguments: "" } }] }, finish_reason: null }] },
      { id: "cmb-test", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ];

    const events = chunks.flatMap((chunk) => openaiToOpenAIResponsesResponse(chunk, state));
    const added = events.find((e) => e.event === "response.output_item.added" && e.data.item?.type === "function_call");
    const done = events.find((e) => e.event === "response.output_item.done" && e.data.item?.type === "function_call");
    const textDone = events.find((e) => e.event === "response.output_text.done");

    expect(added).toBeTruthy();
    expect(done.data.item.status).toBe("completed");
    expect(textDone.data.text).toBe("Let me run that.");
  });

  it("maps Chat usage into the required Responses terminal shape", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    const events = [
      { id: "cmb-test", model: "gpt-test", choices: [{ index: 0, delta: { content: "ok" }, finish_reason: null }] },
      {
        id: "cmb-test",
        model: "gpt-test",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 20,
          total_tokens: 120,
          prompt_tokens_details: { cached_tokens: 80 },
          completion_tokens_details: { reasoning_tokens: 15 },
        },
      },
    ].flatMap((chunk) => {
      if (chunk.usage) state.usage = chunk.usage;
      return openaiToOpenAIResponsesResponse(chunk, state);
    });
    events.push(...openaiToOpenAIResponsesResponse(null, state));

    const completed = events.find((e) => e.event === "response.completed");
    expect(completed.data.response).toMatchObject({
      model: "gpt-test",
      usage: {
        input_tokens: 100,
        input_tokens_details: { cached_tokens: 80 },
        output_tokens: 20,
        output_tokens_details: { reasoning_tokens: 15 },
        total_tokens: 120,
      },
    });
  });

  it("carries usage from the trailing choices-less chunk (OpenRouter/OpenAI)", () => {
    // Real OpenRouter/OpenAI streaming emits the terminal usage in a SEPARATE
    // chunk AFTER finish_reason: {"choices":[],"usage":{...}}. Dropping that
    // chunk published response.completed with zeroed tokens even though
    // 9router's own logs showed the real counts (#telemetry).
    const state = initState(FORMATS.OPENAI_RESPONSES);
    const chunks = [
      { id: "cmb-trail", model: "deepseek-v4.1-flash", choices: [{ index: 0, delta: { content: "hi" }, finish_reason: null }] },
      { id: "cmb-trail", model: "deepseek-v4.1-flash", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      {
        id: "cmb-trail",
        model: "deepseek-v4.1-flash",
        choices: [],
        usage: {
          prompt_tokens: 213619,
          completion_tokens: 2455,
          total_tokens: 216074,
          prompt_tokens_details: { cached_tokens: 210944 },
          completion_tokens_details: { reasoning_tokens: 360 },
        },
      },
    ];

    const events = chunks.flatMap((chunk) => openaiToOpenAIResponsesResponse(chunk, state));
    events.push(...openaiToOpenAIResponsesResponse(null, state));

    const completed = events.find((e) => e.event === "response.completed");
    expect(completed.data.response.usage).toEqual({
      input_tokens: 213619,
      input_tokens_details: { cached_tokens: 210944 },
      output_tokens: 2455,
      output_tokens_details: { reasoning_tokens: 360 },
      total_tokens: 216074,
    });
  });
});
