/**
 * Regression test for #3432:
 * /v1/responses never emitted a `usage` object on `response.completed`, so
 * Responses API clients saw all-zero token counts and no cache-hit data.
 *
 * The upstream chat.completions stream carries usage on a final chunk whose
 * `choices` array is EMPTY, which the transformer skipped before reading it.
 */

import { describe, it, expect } from "vitest";
import { createResponsesApiTransformStream } from "../../open-sse/transformer/responsesTransformer.js";

const encoder = new TextEncoder();

function upstream(chunks) {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    }
  });
}

async function runTransform(chunks) {
  const stream = upstream(chunks).pipeThrough(createResponsesApiTransformStream());
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

function completedPayload(sse) {
  const block = sse
    .split("\n\n")
    .find((b) => b.startsWith("event: response.completed"));
  if (!block) return null;
  return JSON.parse(block.match(/^data:\s*(.+)$/m)[1]);
}

const TEXT_CHUNK = `data: ${JSON.stringify({
  id: "chatcmpl-1",
  choices: [{ index: 0, delta: { content: "391" }, finish_reason: null }]
})}\n\n`;

const FINISH_CHUNK = `data: ${JSON.stringify({
  id: "chatcmpl-1",
  choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
})}\n\n`;

// The shape a real upstream sends: usage arrives with choices: [].
const USAGE_CHUNK = `data: ${JSON.stringify({
  id: "chatcmpl-1",
  choices: [],
  usage: {
    prompt_tokens: 884,
    completion_tokens: 37,
    total_tokens: 921,
    prompt_tokens_details: { cached_tokens: 256 }
  }
})}\n\n`;

describe("responsesTransformer usage propagation (#3432)", () => {
  it("emits usage on response.completed in Responses API shape", async () => {
    const sse = await runTransform([TEXT_CHUNK, USAGE_CHUNK, FINISH_CHUNK, "data: [DONE]\n\n"]);
    const completed = completedPayload(sse);

    expect(completed).not.toBeNull();
    expect(completed.response.usage).toEqual({
      input_tokens: 884,
      output_tokens: 37,
      total_tokens: 921,
      input_tokens_details: { cached_tokens: 256 }
    });
  });

  it("reads usage even when it arrives after the finish chunk", async () => {
    const sse = await runTransform([TEXT_CHUNK, FINISH_CHUNK, USAGE_CHUNK, "data: [DONE]\n\n"]);
    expect(completedPayload(sse).response.usage.input_tokens).toBe(884);
  });

  it("omits input_tokens_details when the upstream reports no cached tokens", async () => {
    const noCache = `data: ${JSON.stringify({
      id: "chatcmpl-1",
      choices: [],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
    })}\n\n`;
    const sse = await runTransform([TEXT_CHUNK, noCache, FINISH_CHUNK, "data: [DONE]\n\n"]);
    const usage = completedPayload(sse).response.usage;

    expect(usage).toEqual({ input_tokens: 10, output_tokens: 5, total_tokens: 15 });
    expect(usage.input_tokens_details).toBeUndefined();
  });

  it("accepts an upstream that already speaks Responses usage names", async () => {
    const native = `data: ${JSON.stringify({
      id: "chatcmpl-1",
      choices: [],
      usage: {
        input_tokens: 7,
        output_tokens: 3,
        total_tokens: 10,
        input_tokens_details: { cached_tokens: 2 }
      }
    })}\n\n`;
    const sse = await runTransform([TEXT_CHUNK, native, FINISH_CHUNK, "data: [DONE]\n\n"]);

    expect(completedPayload(sse).response.usage).toEqual({
      input_tokens: 7,
      output_tokens: 3,
      total_tokens: 10,
      input_tokens_details: { cached_tokens: 2 }
    });
  });

  it("still completes without a usage key when the upstream sends none", async () => {
    const sse = await runTransform([TEXT_CHUNK, FINISH_CHUNK, "data: [DONE]\n\n"]);
    const completed = completedPayload(sse);

    expect(completed.response.status).toBe("completed");
    expect(completed.response).not.toHaveProperty("usage");
  });
});
