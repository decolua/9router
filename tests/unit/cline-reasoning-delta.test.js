import { describe, expect, it } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSEStream } from "../../open-sse/utils/stream.js";

async function forward(delta) {
  const payload = { id: "chatcmpl-valid-id", choices: [{ index: 0, delta }] };
  const input = new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`));
    controller.close();
  } });
  const stream = input.pipeThrough(createSSEStream({
    mode: "passthrough", sourceFormat: FORMATS.OPENAI, targetFormat: FORMATS.OPENAI,
  }));
  const reader = stream.getReader();
  let output = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    output += new TextDecoder().decode(value);
  }
  const line = output.split("\n").find((part) => part.startsWith("data: "));
  return JSON.parse(line.slice(6)).choices[0].delta;
}

describe("OpenAI-compatible reasoning stream", () => {
  it("forwards Cline delta.reasoning as reasoning_content", async () => {
    expect(await forward({ reasoning: "thinking" })).toMatchObject({ reasoning_content: "thinking" });
  });

  it("does not duplicate an existing reasoning_content delta", async () => {
    expect(await forward({ reasoning_content: "existing" })).toMatchObject({ reasoning_content: "existing" });
  });
});
