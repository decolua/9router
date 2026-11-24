import { describe, expect, it } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSEStream } from "../../open-sse/utils/stream.js";

const responsesInput = [
  { type: "response.output_text.delta", delta: "OK" },
  { type: "response.completed", response: { id: "resp_test", status: "completed" } },
].map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");

async function translate(input, targetFormat, sourceFormat) {
  const stream = new Response(input).body.pipeThrough(createSSEStream({ targetFormat, sourceFormat }));
  return new Response(stream).text();
}

function expectSingleDone(output) {
  expect(output.match(/^data: \[DONE\]$/gm)).toHaveLength(1);
  expect(output.endsWith("data: [DONE]\n\n")).toBe(true);
}

describe("translate stream termination", () => {
  it("ends Responses-to-Chat output with one sentinel after the stop chunk", async () => {
    const output = await translate(responsesInput, FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI);
    expect(output).toContain('"content":"OK"');
    expect(output).toContain('"finish_reason":"stop"');
    expectSingleDone(output);
  });

  it("keeps one sentinel when the Chat upstream already sent one", async () => {
    const input = 'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
    const output = await translate(input, FORMATS.OPENAI, FORMATS.OPENAI);
    expect(output).toContain('"finish_reason":"stop"');
    expectSingleDone(output);
  });

  it("ends Claude output with message_stop and no Chat sentinel", async () => {
    const output = await translate(responsesInput, FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE);
    expect(output.trimEnd().split("\n\n").at(-1)).toContain("event: message_stop");
    expect(output).not.toContain("[DONE]");
  });

  it("preserves the completed event and sentinel on Responses passthrough", async () => {
    const output = await translate(responsesInput, FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI_RESPONSES);
    expect(output).toContain("event: response.completed\n");
    expectSingleDone(output);
  });
});
