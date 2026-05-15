import { describe, expect, it, vi } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";

vi.mock("../../src/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn().mockResolvedValue(undefined),
  saveRequestUsage: vi.fn().mockResolvedValue(undefined),
  trackPendingRequest: vi.fn(),
}));

const { createSSEStream } = await import("../../open-sse/utils/stream.js");

async function runStream(transform, chunks) {
  const writer = transform.writable.getWriter();
  const reader = transform.readable.getReader();
  const decoder = new TextDecoder();
  let output = "";

  const reading = (async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      output += decoder.decode(value, { stream: true });
    }
    output += decoder.decode();
  })();

  for (const chunk of chunks) {
    await writer.write(new TextEncoder().encode(chunk));
  }
  await writer.close();
  await reading;

  return output;
}

describe("passthrough SSE termination", () => {
  it("does not append Chat Completions [DONE] for Responses API passthrough", async () => {
    const transform = createSSEStream({
      mode: "passthrough",
      sourceFormat: FORMATS.OPENAI_RESPONSES,
      targetFormat: FORMATS.OPENAI_RESPONSES,
    });

    const output = await runStream(transform, [
      'event: response.completed\n',
      'data: {"type":"response.completed","response":{"id":"resp_1"}}\n\n',
    ]);

    expect(output).toContain('data: {"type":"response.completed"');
    expect(output).toContain("event: response.completed");
    expect(output).not.toContain("data: [DONE]");
  });

  it("keeps Chat Completions [DONE] for OpenAI passthrough clients", async () => {
    const transform = createSSEStream({
      mode: "passthrough",
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI,
    });

    const output = await runStream(transform, [
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
    ]);

    expect(output).toContain('data: {"choices"');
    expect(output).toContain("data: [DONE]");
  });
});
