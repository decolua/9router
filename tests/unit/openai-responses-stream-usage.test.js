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

    const completedLine = output
      .split("\n\n")
      .map((block) => block.split("\n").find((line) => line.startsWith("data: ")))
      .map((line) => line && JSON.parse(line.slice(6)))
      .find((data) => data?.type === "response.completed");

    expect(completedLine).toBeTruthy();
    // addBufferToUsage adds BUFFER_TOKENS (2000) to input for client-side safety,
    // so assert the shape + cache count rather than the exact upstream prompt.
    expect(completedLine.response.usage.input_tokens_details.cached_tokens).toBe(210944);
    expect(completedLine.response.usage.output_tokens_details.reasoning_tokens).toBe(360);
    expect(completedLine.response.usage.output_tokens).toBe(2455);
  });
});
