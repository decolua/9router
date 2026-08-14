import { describe, expect, it } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";

async function translateStream(chunks) {
  const encoder = new TextEncoder();
  const input = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";
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
      "codebuddy-cn",
      null,
      null,
      "deepseek-v4-flash",
      null,
      { input: "Say OK" },
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

function findCompletedEvents(output) {
  const completed = [];
  for (const line of output.split("\n")) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
    const event = JSON.parse(line.slice(6));
    if (event.type === "response.completed") completed.push(event);
  }
  return completed;
}

describe("OpenAI Chat Completions to Responses streaming usage", () => {
  it("forwards a trailing usage-only chunk on response.completed", async () => {
    const output = await translateStream([
      {
        id: "chatcmpl-usage",
        choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: null }],
      },
      {
        id: "chatcmpl-usage",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      },
      {
        id: "chatcmpl-usage",
        choices: [],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 7,
          total_tokens: 19,
          prompt_tokens_details: { cached_tokens: 4 },
          completion_tokens_details: { reasoning_tokens: 3 },
        },
      },
    ]);

    const completed = findCompletedEvents(output);
    expect(completed).toHaveLength(1);
    expect(output.indexOf('"type":"response.completed"')).toBeGreaterThan(
      output.indexOf('"type":"response.output_text.done"'),
    );
    expect(completed[0].response.usage).toEqual({
      input_tokens: 12,
      output_tokens: 7,
      total_tokens: 19,
      input_tokens_details: { cached_tokens: 4 },
      output_tokens_details: { reasoning_tokens: 3 },
    });
  });

  it("forwards usage carried on the finish chunk", async () => {
    const output = await translateStream([
      {
        id: "chatcmpl-finish-usage",
        choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: null }],
      },
      {
        id: "chatcmpl-finish-usage",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      },
    ]);

    const completed = findCompletedEvents(output);
    expect(completed).toHaveLength(1);
    expect(completed[0].response.usage).toEqual({
      input_tokens: 5,
      output_tokens: 2,
      total_tokens: 7,
    });
  });

  it("includes estimated usage when upstream usage is unavailable", async () => {
    const output = await translateStream([
      {
        id: "chatcmpl-no-usage",
        choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: null }],
      },
      {
        id: "chatcmpl-no-usage",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      },
    ]);

    const completed = findCompletedEvents(output);
    expect(completed).toHaveLength(1);
    expect(completed[0].response.usage.input_tokens).toBeGreaterThan(0);
    expect(completed[0].response.usage.output_tokens).toBeGreaterThan(0);
    expect(completed[0].response.usage.total_tokens).toBe(
      completed[0].response.usage.input_tokens + completed[0].response.usage.output_tokens,
    );
  });
});
