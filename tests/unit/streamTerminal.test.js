import { describe, expect, it, vi } from "vitest";
import { createTerminalTracker } from "../../open-sse/utils/streamTerminal.js";
import { createDisconnectAwareStream } from "../../open-sse/utils/streamHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

async function drain(stream) {
  const reader = stream.getReader();
  const parts = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(dec.decode(value));
  }
  return parts.join("");
}

// Minimal controller stub: connected, records which termination was hit.
function makeController() {
  return {
    isConnected: () => true,
    handleComplete: vi.fn(),
    handleError: vi.fn(),
    handleDisconnect: vi.fn(),
  };
}

// Feed chunks through createDisconnectAwareStream and collect what the client sees.
// Mirror production (pipeWithDisconnect): the readable side carries the upstream
// bytes; the writable side is a stub because createDisconnectAwareStream opens
// its own writer there.
async function runStream(tracker, chunks) {
  const passthrough = new TransformStream();
  const writer = passthrough.writable.getWriter();
  const controller = makeController();
  const fakeWritable = { getWriter: () => ({ abort: () => Promise.resolve() }) };
  const out = createDisconnectAwareStream({ readable: passthrough.readable, writable: fakeWritable }, controller, null, tracker);

  const drained = drain(out);
  for (const chunk of chunks) await writer.write(chunk);
  await writer.close();
  const body = await drained;

  return { body, controller };
}

describe("createTerminalTracker", () => {
  it("returns null for formats with no unambiguous terminal marker", () => {
    expect(createTerminalTracker(FORMATS.GEMINI)).toBeNull();
    expect(createTerminalTracker(FORMATS.KIRO)).toBeNull();
    expect(createTerminalTracker("nope")).toBeNull();
  });

  it("detects a non-null finish_reason but not finish_reason:null", () => {
    const t = createTerminalTracker(FORMATS.OPENAI);
    t.observe(enc.encode('data: {"choices":[{"finish_reason":null}]}\n\n'));
    expect(t.sawTerminal()).toBe(false);
    t.observe(enc.encode('data: {"choices":[{"finish_reason":"stop","delta":{}}]}\n\n'));
    expect(t.sawTerminal()).toBe(true);
  });

  it("accepts data: [DONE] as terminal for openai", () => {
    const t = createTerminalTracker(FORMATS.OPENAI);
    t.observe(enc.encode("data: [DONE]\n\n"));
    expect(t.sawTerminal()).toBe(true);
  });

  it("joins a terminal marker straddling two chunks", () => {
    const t = createTerminalTracker(FORMATS.OPENAI);
    t.observe(enc.encode('data: {"choices":[{"finish_re'));
    expect(t.sawTerminal()).toBe(false);
    t.observe(enc.encode('ason":"stop"}]}\n\n'));
    expect(t.sawTerminal()).toBe(true);
  });

  it("stops observing once a terminal was seen", () => {
    const t = createTerminalTracker(FORMATS.OPENAI);
    t.observe(enc.encode('data: {"choices":[{"finish_reason":"stop"}]}\n\n'));
    // Later garbage must not flip state or throw.
    t.observe(enc.encode("junk"));
    expect(t.sawTerminal()).toBe(true);
  });

  it.each(["response.completed", "response.failed", "response.incomplete", "response.done"])(
    "treats %s as terminal for openai-responses",
    (event) => {
      const t = createTerminalTracker(FORMATS.OPENAI_RESPONSES);
      t.observe(enc.encode(`event: ${event}\ndata: {"type":"${event}"}\n\n`));
      expect(t.sawTerminal()).toBe(true);
    }
  );

  it("treats an error event as terminal for openai-responses", () => {
    const t = createTerminalTracker(FORMATS.OPENAI_RESPONSES);
    t.observe(enc.encode('event: error\ndata: {"type":"error","code":"server_error"}\n\n'));
    expect(t.sawTerminal()).toBe(true);
  });

  it("detects message_stop for claude", () => {
    const t = createTerminalTracker(FORMATS.CLAUDE);
    t.observe(enc.encode('event: content_block_delta\ndata: {"type":"content_block_delta"}\n\n'));
    expect(t.sawTerminal()).toBe(false);
    t.observe(enc.encode("event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n"));
    expect(t.sawTerminal()).toBe(true);
  });
});

describe("buildDrop payloads", () => {
  it("openai drop carries upstream_error then [DONE]", async () => {
    const t = createTerminalTracker(FORMATS.OPENAI);
    const text = dec.decode(t.buildDrop());
    expect(text).toContain("upstream_stream_incomplete");
    expect(text).toContain("data: [DONE]");
  });

  it("claude drop is an event: error frame", async () => {
    const t = createTerminalTracker(FORMATS.CLAUDE);
    const text = dec.decode(t.buildDrop());
    expect(text).toContain("event: error");
    expect(text).toContain("api_error");
  });

  it("openai-responses drop reuses the aborted responses terminal", async () => {
    const t = createTerminalTracker(FORMATS.OPENAI_RESPONSES);
    const text = dec.decode(t.buildDrop());
    expect(text).toContain("response.failed");
    expect(text).toContain("data: [DONE]");
  });
});

describe("EOF/done path in createDisconnectAwareStream", () => {
  it("synthesizes a drop when upstream hits EOF without a terminal (openai)", async () => {
    const tracker = createTerminalTracker(FORMATS.OPENAI);
    const { body, controller } = await runStream(tracker, [
      enc.encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'),
    ]);

    expect(body).toContain('"content":"hi"');
    expect(body).toContain("upstream_stream_incomplete");
    expect(controller.handleError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "upstream stream ended without a terminal event" })
    );
    expect(controller.handleComplete).not.toHaveBeenCalled();
  });

  it("closes normally when a terminal was already seen before EOF (openai)", async () => {
    const tracker = createTerminalTracker(FORMATS.OPENAI);
    const { body, controller } = await runStream(tracker, [
      enc.encode('data: {"choices":[{"delta":{"content":"a"},"finish_reason":null}]}\n\n'),
      enc.encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'),
      enc.encode("data: [DONE]\n\n"),
    ]);

    expect(body).not.toContain("upstream_stream_incomplete");
    expect(body.endsWith("data: [DONE]\n\n")).toBe(true);
    expect(controller.handleComplete).toHaveBeenCalled();
    expect(controller.handleError).not.toHaveBeenCalled();
  });

  it("closes normally when response.done arrived (openai-responses)", async () => {
    const tracker = createTerminalTracker(FORMATS.OPENAI_RESPONSES);
    const { body, controller } = await runStream(tracker, [
      enc.encode('event: response.created\ndata: {"type":"response.created"}\n\n'),
      enc.encode('event: response.done\ndata: {"type":"response.done"}\n\n'),
    ]);

    expect(body).not.toContain("response.failed");
    expect(controller.handleComplete).toHaveBeenCalled();
    expect(controller.handleError).not.toHaveBeenCalled();
  });

  it("synthesizes the aborted responses terminal when EOF comes first (openai-responses)", async () => {
    const tracker = createTerminalTracker(FORMATS.OPENAI_RESPONSES);
    const { body, controller } = await runStream(tracker, [
      enc.encode('event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"par"}\n\n'),
    ]);

    expect(body).toContain("response.failed");
    expect(body).toContain("data: [DONE]");
    expect(controller.handleError).toHaveBeenCalled();
    expect(controller.handleComplete).not.toHaveBeenCalled();
  });

  it("does not decorate a healthy claude stream that reached message_stop", async () => {
    const tracker = createTerminalTracker(FORMATS.CLAUDE);
    const { body, controller } = await runStream(tracker, [
      enc.encode('event: message_start\ndata: {"type":"message_start"}\n\n'),
      enc.encode("event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n"),
    ]);

    expect(body).not.toContain("event: error");
    expect(controller.handleComplete).toHaveBeenCalled();
    expect(controller.handleError).not.toHaveBeenCalled();
  });
});
