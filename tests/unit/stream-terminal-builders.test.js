import { describe, expect, it } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { createDisconnectAwareStream } from "../../open-sse/utils/streamHandler.js";
import {
  buildAbortedOpenAIChatTerminalBytes,
  buildAbortedClaudeTerminalBytes,
  buildAbortedAntigravityTerminalBytes,
  buildAbortedResponsesTerminalBytes,
  selectAbortTerminalBuilder,
} from "../../open-sse/utils/streamTerminalBuilders.js";

// Minimal stream controller stub — mirrors responses-abort-terminal.test.js.
function makeController() {
  let connected = true;
  return {
    signal: new AbortController().signal,
    startTime: Date.now(),
    isConnected: () => connected,
    handleComplete: () => {
      connected = false;
    },
    handleError: () => {
      connected = false;
    },
    handleDisconnect: () => {
      connected = false;
    },
    abort: () => {
      connected = false;
    },
  };
}

// Build the same passthrough stub streamHandler uses so tests can drive
// createDisconnectAwareStream directly with a controllable upstream.
function passthroughStub() {
  return {
    readable: null, // overridden per test
    writable: { getWriter: () => ({ abort: () => Promise.resolve() }) },
  };
}

async function readAll(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
}

// Drive an upstream that errors mid-stream (simulates fetch abort on stall).
// Uses "socket hang up" so streamHandler.js takes the network-close graceful
// path (vs propagating the raw error to the downstream reader).
function erroringUpstream(seedChunk) {
  return new ReadableStream({
    start(controller) {
      if (seedChunk) controller.enqueue(new TextEncoder().encode(seedChunk));
      controller.error(new Error("socket hang up"));
    },
  });
}

// Drive an upstream that completes normally with no error.
function cleanUpstream(seedChunk) {
  return new ReadableStream({
    start(controller) {
      if (seedChunk) controller.enqueue(new TextEncoder().encode(seedChunk));
      controller.close();
    },
  });
}

describe("streamTerminalBuilders — pure builders", () => {
  it("buildAbortedResponsesTerminalBytes emits response.failed + [DONE]", () => {
    const bytes = buildAbortedResponsesTerminalBytes();
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("event: response.failed");
    expect(text).toContain("data: [DONE]");
  });

  it("buildAbortedOpenAIChatTerminalBytes emits one finish chunk + one [DONE]", () => {
    const bytes = buildAbortedOpenAIChatTerminalBytes();
    const text = new TextDecoder().decode(bytes);

    // Exactly one finish_reason:"stop" chunk.
    const finishMatches = text.match(/"finish_reason":"stop"/g) || [];
    expect(finishMatches.length).toBe(1);

    // Exactly one [DONE] sentinel.
    const doneMatches = text.match(/data: \[DONE\]/g) || [];
    expect(doneMatches.length).toBe(1);

    // Object identifier for streaming chunks.
    expect(text).toContain('"object":"chat.completion.chunk"');
  });

  it("buildAbortedClaudeTerminalBytes emits message_delta + message_stop, no [DONE]", () => {
    const bytes = buildAbortedClaudeTerminalBytes();
    const text = new TextDecoder().decode(bytes);

    // Exactly one message_delta and one message_stop event.
    expect((text.match(/event: message_delta/g) || []).length).toBe(1);
    expect((text.match(/event: message_stop/g) || []).length).toBe(1);

    // message_delta carries stop_reason: end_turn and zero usage.
    expect(text).toContain('"stop_reason":"end_turn"');
    expect(text).toContain('"input_tokens":0');
    expect(text).toContain('"output_tokens":0');

    // Claude clients key off message_stop — must NOT emit [DONE].
    expect(text).not.toContain("[DONE]");

    // message_stop block must come AFTER message_delta (terminator last).
    expect(text.indexOf("event: message_delta")).toBeLessThan(
      text.indexOf("event: message_stop"),
    );
  });

  it("buildAbortedAntigravityTerminalBytes emits antigravity-framed finishReason:STOP", () => {
    const bytes = buildAbortedAntigravityTerminalBytes();
    const text = new TextDecoder().decode(bytes);

    // Antigravity wrapper shape: { response: { candidates: [{ ..., finishReason: "STOP" }] } }
    expect(text).toContain('"finishReason":"STOP"');
    expect(text).toContain('"role":"model"');
    // The wrapper must be present (distinguishes antigravity from native Gemini).
    expect(text).toContain('"response":');

    // Exactly one chunk with finishReason (no duplicate emission).
    expect((text.match(/"finishReason":"STOP"/g) || []).length).toBe(1);

    // Should not leak a Responses failure event or a [DONE] sentinel.
    expect(text).not.toContain("response.failed");
    expect(text).not.toContain("data: [DONE]");
  });
});

describe("streamTerminalBuilders — selectAbortTerminalBuilder", () => {
  it("returns the correct builder for each mapped FORMAT", () => {
    expect(selectAbortTerminalBuilder(FORMATS.OPENAI_RESPONSES)).toBe(
      buildAbortedResponsesTerminalBytes,
    );
    expect(selectAbortTerminalBuilder(FORMATS.CLAUDE)).toBe(
      buildAbortedClaudeTerminalBytes,
    );
    expect(selectAbortTerminalBuilder(FORMATS.OPENAI)).toBe(
      buildAbortedOpenAIChatTerminalBytes,
    );
    expect(selectAbortTerminalBuilder(FORMATS.GEMINI)).toBe(
      buildAbortedAntigravityTerminalBytes,
    );
    expect(selectAbortTerminalBuilder(FORMATS.GEMINI_CLI)).toBe(
      buildAbortedAntigravityTerminalBytes,
    );
    expect(selectAbortTerminalBuilder(FORMATS.ANTIGRAVITY)).toBe(
      buildAbortedAntigravityTerminalBytes,
    );
    expect(selectAbortTerminalBuilder(FORMATS.VERTEX)).toBe(
      buildAbortedAntigravityTerminalBytes,
    );
  });

  it("returns null for unmapped or falsy sourceFormat", () => {
    expect(selectAbortTerminalBuilder("unknown-format")).toBe(null);
    expect(selectAbortTerminalBuilder(FORMATS.KIRO)).toBe(null);
    expect(selectAbortTerminalBuilder(FORMATS.CURSOR)).toBe(null);
    expect(selectAbortTerminalBuilder(FORMATS.OLLAMA)).toBe(null);
    expect(selectAbortTerminalBuilder(FORMATS.COMMANDCODE)).toBe(null);
    expect(selectAbortTerminalBuilder(null)).toBe(null);
    expect(selectAbortTerminalBuilder(undefined)).toBe(null);
    expect(selectAbortTerminalBuilder("")).toBe(null);
  });
});

describe("streamTerminalBuilders — wire through createDisconnectAwareStream", () => {
  it("Claude abort: emits exactly one message_stop, no [DONE]", async () => {
    const stub = passthroughStub();
    stub.readable = erroringUpstream(
      'event: message_start\ndata: {"type":"message_start"}\n\n',
    );

    const out = createDisconnectAwareStream(
      stub,
      makeController(),
      buildAbortedClaudeTerminalBytes,
    );
    const text = await readAll(out);

    expect((text.match(/event: message_stop/g) || []).length).toBe(1);
    expect(text).toContain('"stop_reason":"end_turn"');
    expect(text).not.toContain("[DONE]");
  });

  it("OpenAI-chat abort: emits exactly one finish chunk + one [DONE]", async () => {
    const stub = passthroughStub();
    stub.readable = erroringUpstream(
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
    );

    const out = createDisconnectAwareStream(
      stub,
      makeController(),
      buildAbortedOpenAIChatTerminalBytes,
    );
    const text = await readAll(out);

    expect((text.match(/"finish_reason":"stop"/g) || []).length).toBe(1);
    expect((text.match(/data: \[DONE\]/g) || []).length).toBe(1);
  });

  it("Gemini-family abort: emits antigravity-framed finishReason:STOP, no response.failed", async () => {
    const stub = passthroughStub();
    stub.readable = erroringUpstream(
      'data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"text":"hi"}]}}]}}\n\n',
    );

    const out = createDisconnectAwareStream(
      stub,
      makeController(),
      buildAbortedAntigravityTerminalBytes,
    );
    const text = await readAll(out);

    expect((text.match(/"finishReason":"STOP"/g) || []).length).toBe(1);
    expect(text).toContain('"role":"model"');
    expect(text).not.toContain("response.failed");
    expect(text).not.toContain("data: [DONE]");
  });

  it("Responses abort regression: response.failed + [DONE] unchanged", async () => {
    const stub = passthroughStub();
    stub.readable = erroringUpstream("event: response.created\ndata: {}\n\n");

    const out = createDisconnectAwareStream(
      stub,
      makeController(),
      buildAbortedResponsesTerminalBytes,
    );
    const text = await readAll(out);

    expect(text).toContain("event: response.failed");
    expect(text).toContain("data: [DONE]");
    // Exactly one [DONE] — no duplicate terminal emission.
    expect((text.match(/data: \[DONE\]/g) || []).length).toBe(1);
  });

  it("No-builder formats: upstream error closes gracefully with no synthesized terminal", async () => {
    const stub = passthroughStub();
    stub.readable = erroringUpstream("data: hi\n\n");

    const out = createDisconnectAwareStream(stub, makeController(), null);
    const text = await readAll(out);

    expect(text).not.toContain("response.failed");
    expect(text).not.toContain("[DONE]");
    expect(text).not.toContain("message_stop");
    expect(text).not.toContain("finishReason");
  });

  it("Duplicate guard / idempotency: terminal block appears exactly once across disconnect-then-error", async () => {
    // Build an upstream that emits a chunk then errors immediately.
    // createDisconnectAwareStream's terminalEmitted flag must hold across
    // the single error path so we never enqueue the terminal twice even if
    // the wrapper were re-entered.
    const stub = passthroughStub();
    stub.readable = erroringUpstream(
      'event: message_start\ndata: {"type":"message_start"}\n\n',
    );

    const out = createDisconnectAwareStream(
      stub,
      makeController(),
      buildAbortedClaudeTerminalBytes,
    );
    const text = await readAll(out);

    expect((text.match(/event: message_stop/g) || []).length).toBe(1);
    expect((text.match(/event: message_delta/g) || []).length).toBe(1);
  });

  it("Clean completion exclusivity: abort terminal is NOT emitted when upstream closes normally", async () => {
    // When the upstream completes cleanly (done, no error) the abort path
    // must NOT fire — flush() / clean EOF owns termination, and synthesizing
    // a stop event would duplicate it.
    const stub = passthroughStub();
    stub.readable = cleanUpstream(
      'event: message_start\ndata: {"type":"message_start"}\n\nevent: ping\ndata: {}\n\n',
    );

    const out = createDisconnectAwareStream(
      stub,
      makeController(),
      buildAbortedClaudeTerminalBytes,
    );
    const text = await readAll(out);

    expect(text).not.toContain("event: message_stop");
    expect(text).not.toContain('"stop_reason":"end_turn"');
  });
});
