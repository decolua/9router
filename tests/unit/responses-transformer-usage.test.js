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

function createChatCompletionsStream() {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(CHAT_COMPLETIONS_STREAM));
      controller.close();
    },
  });
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
  it("includes final Chat Completions usage in response.completed", async () => {
    const output = await readStream(
      createChatCompletionsStream().pipeThrough(createResponsesApiTransformStream()),
    );
    const completedData = output
      .split("\n\n")
      .find((event) => event.startsWith("event: response.completed"))
      ?.match(/^data: (.+)$/m)?.[1];

    expect(JSON.parse(completedData).response.usage).toEqual({
      input_tokens: 884,
      output_tokens: 37,
      total_tokens: 921,
      input_tokens_details: { cached_tokens: 256 },
      output_tokens_details: { reasoning_tokens: 12 },
    });
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
