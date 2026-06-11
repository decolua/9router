import { describe, it, expect } from "vitest";
import { createPassthroughStreamWithLogger, createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function collectOutput(chunks) {
  const source = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  const reader = source
    .pipeThrough(createPassthroughStreamWithLogger("codex", null, "gpt-5.4", "conn-test", {}))
    .getReader();

  let output = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    output += decoder.decode(value, { stream: true });
  }
  output += decoder.decode();
  return output;
}

async function collectTranslatedOutput(chunks) {
  const source = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  const reader = source
    .pipeThrough(
      createSSETransformStreamWithLogger(
        FORMATS.OPENAI_RESPONSES,
        FORMATS.OPENAI_RESPONSES,
        "codex",
        null,
        null,
        "gpt-5.4",
        "conn-test",
        {}
      )
    )
    .getReader();

  let output = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    output += decoder.decode(value, { stream: true });
  }
  output += decoder.decode();
  return output;
}

describe("passthrough SSE null-frame handling", () => {
  it("drops data: null frames while preserving meaningful events and DONE", async () => {
    const output = await collectOutput([
      'event: response.created\ndata: {"type":"response.created","response":{"id":"resp_test","object":"response","status":"in_progress","output":[]}}\n\n',
      'data: null\n\n',
      'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_test","object":"response","status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"ok"}]}]}}\n\n',
    ]);

    expect(output).toContain('event: response.created');
    expect(output).toContain('event: response.completed');
    expect(output).toContain('data: [DONE]');
    expect(output).not.toContain('data: null');
  });

  it("drops a trailing buffered data: null frame during flush", async () => {
    const output = await collectOutput([
      'event: response.created\ndata: {"type":"response.created","response":{"id":"resp_test","object":"response","status":"in_progress","output":[]}}\n\n',
      'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_test","object":"response","status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"ok"}]}]}}\n\n',
      'data: null'
    ]);

    expect(output).toContain('event: response.created');
    expect(output).toContain('event: response.completed');
    expect(output).toContain('data: [DONE]');
    expect(output).not.toContain('data: null');
  });

  it("does not emit data: null on same-format translation flush", async () => {
    const output = await collectTranslatedOutput([
      'event: response.created\ndata: {"type":"response.created","response":{"id":"resp_test","object":"response","status":"in_progress","output":[]}}\n\n',
      'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_test","object":"response","status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"ok"}]}]}}\n\n'
    ]);

    expect(output).toContain('"type":"response.created"');
    expect(output).toContain('"type":"response.completed"');
    expect(output).toContain('data: [DONE]');
    expect(output).not.toContain('data: null');
  });
});
