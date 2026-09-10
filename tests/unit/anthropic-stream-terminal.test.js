import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(),
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { createPassthroughStreamWithLogger } = await import("../../open-sse/utils/stream.js");

const encoder = new TextEncoder();

async function runClaudePassthrough(input, onStreamComplete = null) {
  const source = new ReadableStream({
    start(controller) {
      if (input) controller.enqueue(encoder.encode(input));
      controller.close();
    },
  });
  const output = source.pipeThrough(createPassthroughStreamWithLogger(
    "anthropic",
    null,
    "claude-test",
    "connection-test",
    {},
    onStreamComplete,
    null,
    FORMATS.CLAUDE,
  ));
  return new Response(output).text();
}

describe("Anthropic stream terminal boundary", () => {
  it("emits event:error, not message_stop or DONE, on incomplete EOF", async () => {
    const output = await runClaudePassthrough([
      'event: message_start',
      'data: {"type":"message_start","message":{"id":"msg_test"}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"partial"}}',
      '',
    ].join("\n"));

    expect(output).toContain("event: error");
    expect(output).toContain("stream closed before message_stop");
    expect(output).not.toContain("event: message_stop");
    expect(output).not.toContain("data: [DONE]");
  });

  it("preserves message_stop and marks genuine completion", async () => {
    const onStreamComplete = vi.fn();
    const input = [
      'event: message_start',
      'data: {"type":"message_start","message":{"id":"msg_test"}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}',
      '',
    ].join("\n");

    const output = await runClaudePassthrough(input, onStreamComplete);

    expect(output).toContain("event: message_stop");
    expect(output).not.toContain("event: error");
    expect(output).not.toContain("data: [DONE]");
    expect(onStreamComplete).toHaveBeenCalledWith(
      expect.any(Object),
      null,
      expect.any(Number),
      { genuineTerminal: true },
    );
  });

  it("does not mark an incomplete close as genuine completion", async () => {
    const onStreamComplete = vi.fn();
    await runClaudePassthrough(
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_test"}}\n\n',
      onStreamComplete,
    );

    expect(onStreamComplete).toHaveBeenCalledWith(
      expect.any(Object),
      null,
      expect.any(Number),
      { genuineTerminal: false },
    );
  });
});
