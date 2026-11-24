import { describe, expect, it } from "vitest";

import { convertResponsesStreamToJson } from "../../open-sse/transformer/streamToJsonConverter.js";
import { createResponsesApiTransformStream } from "../../open-sse/transformer/responsesTransformer.js";

const CHAT_COMPLETIONS_STREAM = [
  'data: {"id":"chatcmpl-usage","choices":[{"index":0,"delta":{"content":"hello"},"finish_reason":null}]}',
  'data: {"id":"chatcmpl-usage","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
  'data: {"id":"chatcmpl-usage","choices":[],"usage":{"prompt_tokens":884,"completion_tokens":37,"total_tokens":921,"prompt_tokens_details":{"cached_tokens":256},"completion_tokens_details":{"reasoning_tokens":12}}}',
  "data: [DONE]",
  "",
].join("\n\n");

function createChatCompletionsStream(stream = CHAT_COMPLETIONS_STREAM) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(stream));
      controller.close();
    },
  });
}

async function readCompletedResponse(stream = CHAT_COMPLETIONS_STREAM) {
  const output = await readStream(
    createChatCompletionsStream(stream).pipeThrough(createResponsesApiTransformStream()),
  );
  const completedData = output
    .split("\n\n")
    .find((event) => event.startsWith("event: response.completed"))
    ?.match(/^data: (.+)$/m)?.[1];

  return JSON.parse(completedData).response;
}

async function readStream(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    output += decoder.decode(value, { stream: true });
  }

  return output + decoder.decode();
}

describe("Responses API transformer usage", () => {
  it("includes Chat Completions usage that arrives after finish_reason", async () => {
    const response = await readCompletedResponse();

    expect(response.usage).toEqual({
      input_tokens: 884,
      output_tokens: 37,
      total_tokens: 921,
      input_tokens_details: { cached_tokens: 256 },
      output_tokens_details: { reasoning_tokens: 12 },
    });
  });

  it("accepts usage already shaped like a Responses API payload", async () => {
    const stream = [
      'data: {"id":"chatcmpl-native","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
      'data: {"id":"chatcmpl-native","choices":[],"usage":{"input_tokens":20,"output_tokens":5,"total_tokens":25,"input_tokens_details":{"cached_tokens":7},"output_tokens_details":{"reasoning_tokens":3}}}',
      "data: [DONE]",
      "",
    ].join("\n\n");

    const response = await readCompletedResponse(stream);

    expect(response.usage).toEqual({
      input_tokens: 20,
      output_tokens: 5,
      total_tokens: 25,
      input_tokens_details: { cached_tokens: 7 },
      output_tokens_details: { reasoning_tokens: 3 },
    });
  });

  it("omits token detail objects when the upstream usage has no details", async () => {
    const stream = [
      'data: {"id":"chatcmpl-no-details","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
      'data: {"id":"chatcmpl-no-details","choices":[],"usage":{"prompt_tokens":8,"completion_tokens":2}}',
      "data: [DONE]",
      "",
    ].join("\n\n");

    const response = await readCompletedResponse(stream);

    expect(response.usage).toEqual({
      input_tokens: 8,
      output_tokens: 2,
      total_tokens: 10,
    });
  });

  it("omits usage when the upstream stream sends no usage chunk", async () => {
    const stream = [
      'data: {"id":"chatcmpl-no-usage","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
      "data: [DONE]",
      "",
    ].join("\n\n");

    const response = await readCompletedResponse(stream);

    expect(response).not.toHaveProperty("usage");
  });

  it("preserves transformed usage in a non-streaming Responses body", async () => {
    const responsesStream = createChatCompletionsStream().pipeThrough(
      createResponsesApiTransformStream(),
    );

    await expect(convertResponsesStreamToJson(responsesStream)).resolves.toMatchObject({
      usage: {
        input_tokens: 884,
        output_tokens: 37,
        total_tokens: 921,
      },
    });
  });
});
