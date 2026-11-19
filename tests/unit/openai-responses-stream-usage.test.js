/**
 * Regression: client speaks OpenAI Responses, upstream speaks OpenAI Chat
 * (FMT: openai-responses→openai, e.g. OpenRouter). OpenAI-compatible upstreams
 * put the terminal usage in a SEPARATE chunk with an empty `choices` array,
 * sent AFTER the finish_reason chunk:
 *
 *   {"choices":[{"finish_reason":"stop"}]}
 *   {"choices":[],"usage":{"prompt_tokens":...,"prompt_tokens_details":{"cached_tokens":...}}}
 *
 * The Responses translator used to emit response.completed on the finish chunk
 * (zero usage) and drop the choices-less usage chunk, so the client saw 0
 * tokens/cache while 9router's own logs showed the real counts (#telemetry).
 */
import { describe, expect, it } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { initState, translateResponse } from "../../open-sse/translator/index.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";

async function runTransform(input) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(input));
      controller.close();
    },
  });

  const output = stream.pipeThrough(
    createSSETransformStreamWithLogger(
      FORMATS.OPENAI,
      FORMATS.OPENAI_RESPONSES,
      "openrouter",
      null,
      null,
      "deepseek-v4.1-flash",
    ),
  );

  const reader = output.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
}

function parseResponsesEvents(output) {
  return output.split("\n")
    .filter((line) => line.startsWith("data: {"))
    .map((line) => JSON.parse(line.slice(6)));
}

const isTerminalEvent = (type) => ["response.completed", "response.incomplete", "response.failed"].includes(type);

describe("OpenAI Chat → Responses: trailing usage chunk", () => {
  it("publishes response.completed with cache + reasoning from the choices-less usage chunk", async () => {
    const input = [
      `data: ${JSON.stringify({ id: "cmb-trail", model: "deepseek-v4.1-flash", choices: [{ index: 0, delta: { content: "hi" }, finish_reason: null }] })}`,
      "",
      `data: ${JSON.stringify({ id: "cmb-trail", model: "deepseek-v4.1-flash", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}`,
      "",
      `data: ${JSON.stringify({
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
      })}`,
      "",
      "data: [DONE]",
      "",
    ].join("\n");

    const output = await runTransform(input);

    const completedLine = parseResponsesEvents(output).find((data) => data.type === "response.completed");

    expect(completedLine).toBeTruthy();
    // addBufferToUsage adds BUFFER_TOKENS (2000) to input for client-side safety,
    // so assert the shape + cache count rather than the exact upstream prompt.
    expect(completedLine.response.usage.input_tokens_details.cached_tokens).toBe(210944);
    expect(completedLine.response.usage.output_tokens_details.reasoning_tokens).toBe(360);
    expect(completedLine.response.usage.output_tokens).toBe(2455);
  });
});

describe("Chat output limits translated to Responses", () => {
  it.each(["finish chunk", "usage trailer"])("emits one incomplete event with usage from the %s", async (usageSource) => {
    const usage = {
      prompt_tokens: 120,
      completion_tokens: 24,
      total_tokens: 144,
      prompt_tokens_details: { cached_tokens: 80 },
      completion_tokens_details: { reasoning_tokens: 8 },
    };
    const chunks = [{
      id: "chatcmpl-limit",
      choices: [{ index: 0, delta: { content: "<think>partial" }, finish_reason: "length" }],
      ...(usageSource === "finish chunk" ? { usage } : {}),
    }];
    if (usageSource === "usage trailer") {
      chunks.unshift({
        id: "chatcmpl-limit",
        choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
        usage: { prompt_tokens: 120, completion_tokens: 1 },
      });
      chunks.push({ id: "chatcmpl-limit", choices: [], usage });
    }
    const output = await runTransform(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n");

    expect(output.match(/^event: response\.incomplete$/gm)).toHaveLength(1);
    const terminal = parseResponsesEvents(output).filter(({ type }) => isTerminalEvent(type));
    expect(terminal).toHaveLength(1);
    expect(terminal[0]).toMatchObject({
      type: "response.incomplete",
      response: {
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output: [{ type: "reasoning", summary: [{ type: "summary_text", text: "partial" }] }],
        usage: {
          input_tokens: 120,
          output_tokens: 24,
          total_tokens: 144,
          input_tokens_details: { cached_tokens: 80 },
          output_tokens_details: { reasoning_tokens: 8 },
        },
      },
    });
  });

  it("emits an incomplete terminal on flush when upstream has no usage", () => {
    const state = { ...initState(FORMATS.OPENAI_RESPONSES), targetFormat: FORMATS.OPENAI };
    const translate = (chunk) => translateResponse(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, chunk, state);
    const events = translate({ choices: [{ index: 0, delta: { content: "partial" }, finish_reason: "length" }] });
    expect(events.some(({ event }) => isTerminalEvent(event))).toBe(false);

    const terminal = translate(null);
    expect(terminal).toHaveLength(1);
    expect(terminal[0].event).toBe("response.incomplete");
    expect(terminal[0].data.response).not.toHaveProperty("usage");
    expect(translate(null)).toEqual([]);
  });
});

describe("Deferred Claude to Responses terminal", () => {
  it.each([
    ["end_turn", "response.completed", "completed", null],
    ["max_tokens", "response.incomplete", "incomplete", { reason: "max_output_tokens" }],
  ])("waits for message_stop after %s", (stopReason, type, status, incompleteDetails) => {
    const state = { ...initState(FORMATS.OPENAI_RESPONSES), targetFormat: FORMATS.CLAUDE, deferResponsesTerminal: true };
    const translateClaude = (chunk) => translateResponse(FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES, chunk, state);
    const flushResponses = () => translateResponse(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, null, state);

    translateClaude({ type: "message_start", message: { id: "msg_test", usage: { input_tokens: 40, cache_read_input_tokens: 80 } } });
    const delta = translateClaude({ type: "message_delta", delta: { stop_reason: stopReason }, usage: { output_tokens: 24 } });
    expect(delta.some(({ event }) => isTerminalEvent(event))).toBe(false);
    expect(flushResponses()).toEqual([]);
    expect(translateClaude({ type: "message_stop" })).toEqual([]);

    state.deferResponsesTerminal = false;
    const terminal = flushResponses();
    expect(terminal).toHaveLength(1);
    expect(terminal[0]).toMatchObject({
      event: type,
      data: {
        type,
        response: {
          status,
          incomplete_details: incompleteDetails,
          usage: { input_tokens: 120, output_tokens: 24, total_tokens: 144, input_tokens_details: { cached_tokens: 80 } },
        },
      },
    });
    expect(flushResponses()).toEqual([]);
  });
});
