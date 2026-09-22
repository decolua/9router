import { describe, expect, it } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";

/**
 * Upstream chunks -> client Responses API events.
 *
 * The converter under test is openaiToOpenAIResponsesResponse(), reached through
 * the registered OPENAI:OPENAI_RESPONSES pair. Without it, /v1/responses never
 * reports usage and Responses clients (Codex CLI) keep their context gauge at 0,
 * so they never auto-compact and eventually hit the upstream context limit.
 *
 * Signature is (targetFormat, sourceFormat, ...) — targetFormat is what the
 * UPSTREAM speaks, sourceFormat is what the CLIENT speaks.
 */
async function runTransform(chunks, targetFormat = FORMATS.OPENAI) {
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
      targetFormat,
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

function completedEvents(output) {
  return output
    .split("\n")
    .filter((l) => l.startsWith("data: ") && l.includes('"type":"response.completed"'));
}

function completedResponse(output) {
  const lines = completedEvents(output);
  expect(lines.length, "expected exactly one response.completed").toBe(1);
  return JSON.parse(lines[0].slice(6)).response;
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

// Claude-shaped stream with NO usage anywhere: the only way the client gets a
// terminal event is the finish_reason branch, because the pivot never reaches
// flushEvents() with the terminal null chunk.
const CLAUDE_CHUNKS = [
  { type: "message_start", message: { id: "msg_1", model: "claude-x" } },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hi" } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "end_turn" } },
  { type: "message_stop" },
];

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

  // Regression guard for the pivot: with a Claude upstream the converter runs as
  // the second hop, translateResponse() drops the terminal null chunk before it
  // reaches this converter, so flushEvents() never runs. Deferring completion
  // there would leave the client without any terminal event.
  it("completes on a pivoted stream whose upstream never reports usage", async () => {
    const output = await runTransform(CLAUDE_CHUNKS, FORMATS.CLAUDE);

    const response = completedResponse(output);
    expect(response.status).toBe("completed");
  });
});
