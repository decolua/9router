import { describe, expect, it, vi } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import {
  preflightTransformedStream,
  StreamPreflightError,
} from "../../open-sse/utils/streamPreflight.js";

const encoder = new TextEncoder();

function streamFromChunks(...chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(stream) {
  return new Response(stream).text();
}

describe("transformed stream preflight", () => {
  it("preserves split Claude message_start bytes exactly", async () => {
    const chunks = [
      ": ping\n\nevent: message_",
      'start\ndata: {"type":"message_start","message":{"id":"msg_1"}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ];

    const replay = await preflightTransformedStream(
      streamFromChunks(...chunks),
      FORMATS.CLAUDE,
      { timeoutMs: 100, maxBytes: 65536 },
    );

    await expect(collect(replay)).resolves.toBe(chunks.join(""));
  });

  it("rejects empty EOF before commit", async () => {
    await expect(preflightTransformedStream(
      streamFromChunks(),
      FORMATS.CLAUDE,
      { timeoutMs: 100 },
    )).rejects.toMatchObject({
      name: "StreamPreflightError",
      status: 502,
    });
  });

  it("rejects malformed Claude first event", async () => {
    await expect(preflightTransformedStream(
      streamFromChunks("event: message_start\ndata: {bad json}\n\n"),
      FORMATS.CLAUDE,
      { timeoutMs: 100 },
    )).rejects.toThrow("malformed JSON");
  });

  it("converts first Claude error event into pre-commit failure", async () => {
    await expect(preflightTransformedStream(
      streamFromChunks('event: error\ndata: {"type":"error","error":{"message":"busy"}}\n\n'),
      FORMATS.CLAUDE,
      { timeoutMs: 100 },
    )).rejects.toThrow("busy");
  });

  it("skips a leading ping event and preserves bytes exactly", async () => {
    const chunks = [
      'event: ping\ndata: {"type":"ping"}\n\n',
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1"}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ];
    const replay = await preflightTransformedStream(
      streamFromChunks(...chunks),
      FORMATS.CLAUDE,
      { timeoutMs: 100, maxBytes: 65536 },
    );
    await expect(collect(replay)).resolves.toBe(chunks.join(""));
  });

  it("accepts first non-empty output for non-Claude formats", async () => {
    const chunks = [" \n", 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n'];
    const replay = await preflightTransformedStream(
      streamFromChunks(...chunks),
      FORMATS.OPENAI,
      { timeoutMs: 100 },
    );
    await expect(collect(replay)).resolves.toBe(chunks.join(""));
  });

  it("uses one total deadline across heartbeat chunks", async () => {
    vi.useFakeTimers();
    try {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(": ping\n\n"));
          setTimeout(() => controller.enqueue(encoder.encode(": ping\n\n")), 40);
          setTimeout(() => controller.enqueue(encoder.encode(": ping\n\n")), 80);
        },
      });
      const pending = preflightTransformedStream(stream, FORMATS.CLAUDE, {
        timeoutMs: 100,
        maxBytes: 65536,
      });
      const assertion = expect(pending).rejects.toEqual(expect.objectContaining({
        code: "stream_preflight_timeout",
        status: 504,
      }));
      await vi.advanceTimersByTimeAsync(110);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("exports a typed preflight error", () => {
    expect(new StreamPreflightError("x")).toMatchObject({ status: 502, code: "stream_preflight_failed" });
  });
});
