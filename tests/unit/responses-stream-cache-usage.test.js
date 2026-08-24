import { describe, expect, it } from "vitest";
import { convertResponsesStreamToJson } from "../../open-sse/transformer/streamToJsonConverter.js";

describe("Responses stream cache usage", () => {
  it("preserves input token details from the terminal event", async () => {
    const encoder = new TextEncoder();
    const payload = [
      "event: response.completed",
      `data: ${JSON.stringify({ response: { id: "resp_cache", usage: { input_tokens: 500, output_tokens: 50, total_tokens: 550, input_tokens_details: { cached_tokens: 120, cache_creation_tokens: 40 } } } })}`,
      "",
      "",
    ].join("\n");
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(payload));
        controller.close();
      },
    });

    const result = await convertResponsesStreamToJson(stream);

    expect(result.usage).toEqual({
      input_tokens: 500,
      output_tokens: 50,
      total_tokens: 550,
      input_tokens_details: { cached_tokens: 120, cache_creation_tokens: 40 },
    });
  });
});
