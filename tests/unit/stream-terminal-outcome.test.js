import { describe, expect, it } from "vitest";

import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";

async function readStream(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

function streamFromText(text) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

describe("stream terminal outcome reporting", () => {
  it("reports a late Responses capacity failure from passthrough streams", async () => {
    const outcomes = [];
    const source = streamFromText([
      "event: response.output_text.delta",
      `data: ${JSON.stringify({
        type: "response.output_text.delta",
        delta: "partial output",
      })}`,
      "",
      "event: response.failed",
      `data: ${JSON.stringify({
        type: "response.failed",
        response: {
          status: "failed",
          error: {
            code: "model_at_capacity",
            message: "Selected model is at capacity. Please try a different model.",
          },
        },
      })}`,
      "",
    ].join("\n"));

    const transform = createPassthroughStreamWithLogger(
      "codex",
      null,
      "gpt-5.5",
      "conn_1",
      { input: [{ role: "user", content: "hello" }] },
      (_content, _usage, _ttftAt, outcome) => outcomes.push(outcome),
      "sk-test",
    );

    await readStream(source.pipeThrough(transform));

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({
      status: "failure",
      errorStatus: 503,
      message: "Selected model is at capacity. Please try a different model.",
      code: "model_at_capacity",
    });
  });
});
