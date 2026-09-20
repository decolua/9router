import { describe, expect, it } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";

/**
 * Upstream Chat Completions chunks -> client Responses API events.
 *
 * The converter under test is openaiToOpenAIResponsesResponse(), reached through
 * the registered OPENAI:OPENAI_RESPONSES pair. Without it, /v1/responses never
 * reports usage and Responses clients (Codex CLI) keep their context gauge at 0,
 * so they never auto-compact and eventually hit the upstream context limit.
 */
async function runTransform(chunks) {
  const encoder = new TextEncoder();
  const input = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("");

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
      "deepseek",
      null,
      null,
      "deepseek-flash",
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

function completedResponse(output) {
  const line = output
    .split("\n")
    .filter((l) => l.startsWith("data: ") && l.includes('"type":"response.completed"'))
    .pop();

  expect(line, "response.completed event was not emitted").toBeTruthy();
  return JSON.parse(line.slice(6)).response;
}

const TEXT_CHUNK = {
  id: "chatcmpl-test",
  object: "chat.completion.chunk",
  created: 1700000000,
  model: "deepseek-flash",
  choices: [{ index: 0, delta: { role: "assistant", content: "好" } }],
};

const FINISH_CHUNK = {
  id: "chatcmpl-test",
  object: "chat.completion.chunk",
  created: 1700000000,
  model: "deepseek-flash",
  choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
};

// Usage-only trailer: `choices` is empty, exactly as OpenAI emits it when
// stream_options.include_usage is set.
const USAGE_ONLY_CHUNK = {
  id: "chatcmpl-test",
  object: "chat.completion.chunk",
  created: 1700000000,
  model: "deepseek-flash",
  choices: [],
  usage: {
    prompt_tokens: 884,
    completion_tokens: 37,
    total_tokens: 921,
    prompt_tokens_details: { cached_tokens: 256 },
  },
};

const EXPECTED_USAGE = {
  input_tokens: 884,
  output_tokens: 37,
  total_tokens: 921,
  input_tokens_details: { cached_tokens: 256 },
};

describe("OpenAI Responses usage on response.completed", () => {
  it("maps usage reported on the finish chunk", async () => {
    const output = await runTransform([
      TEXT_CHUNK,
      {
        ...FINISH_CHUNK,
        usage: {
          prompt_tokens: 884,
          completion_tokens: 37,
          total_tokens: 921,
          prompt_tokens_details: { cached_tokens: 256 },
          completion_tokens_details: { reasoning_tokens: 12 },
        },
      },
    ]);

    expect(completedResponse(output).usage).toEqual({
      ...EXPECTED_USAGE,
      output_tokens_details: { reasoning_tokens: 12 },
    });
  });

  it("maps usage reported on a trailing usage-only chunk with empty choices", async () => {
    const output = await runTransform([TEXT_CHUNK, FINISH_CHUNK, USAGE_ONLY_CHUNK]);

    expect(completedResponse(output).usage).toEqual(EXPECTED_USAGE);
  });

  it("still completes when the upstream reports no usage at all", async () => {
    const output = await runTransform([TEXT_CHUNK, FINISH_CHUNK]);

    const response = completedResponse(output);
    expect(response.status).toBe("completed");
    expect(response).not.toHaveProperty("usage");
  });
});
