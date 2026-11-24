/**
 * Unit tests for CommandCode embedded-error detection.
 *
 * CommandCode can return HTTP 200 with an embedded error event
 * (e.g. {"type":"error","error":{"type":"server_error","statusCode":503,
 * "isRetryable":true,...}}) instead of a non-2xx status. We must detect this on
 * the first frame and return a synthetic error Response so chatCore marks the
 * connection unavailable and combo/account fallback picks the next model —
 * instead of leaking "[CommandCode error: ...]" into chat as a successful reply.
 */

import { describe, it, expect } from "vitest";
import { __test__ as cmdccInternals } from "../../open-sse/executors/commandcode.js";

const { peekFirstCommandCodeFrame, wrapNdjsonAsOpenAISse } = cmdccInternals;

function makeResponse(bodyLines) {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(c) {
      for (const l of bodyLines) c.enqueue(enc.encode(l + "\n"));
      c.close();
    },
  });
  return new Response(stream, { status: 200, statusText: "OK" });
}

const err503 = JSON.stringify({
  type: "error",
  error: {
    type: "server_error",
    message: "Service temporarily unavailable. Please try again shortly.",
    statusCode: 503,
    isRetryable: true,
  },
});

describe("peekFirstCommandCodeFrame detects embedded server error", () => {
  it("fails when the first frame is a 503 server_error", async () => {
    const peek = await peekFirstCommandCodeFrame(makeResponse([err503]));
    expect(peek.isError).toBe(true);
    expect(peek.status).toBe(503);
    expect(peek.message).toContain("Service temporarily unavailable");
  });

  it("fails when an error follows non-content frames (start/start-step)", async () => {
    const peek = await peekFirstCommandCodeFrame(
      makeResponse([JSON.stringify({ type: "start" }), JSON.stringify({ type: "start-step" }), err503])
    );
    expect(peek.isError).toBe(true);
    expect(peek.status).toBe(503);
  });

  it("does NOT fail when a content frame arrives before the error", async () => {
    // Once text/tool content has started, the stream is healthy up to that
    // point → proceed normally (a mid-stream note is handled by the translator).
    const peek = await peekFirstCommandCodeFrame(
      makeResponse([JSON.stringify({ type: "text-delta", text: "Hi" }), err503])
    );
    expect(peek.isError).toBe(false);
  });

  it("does NOT fail on a healthy stream", async () => {
    const peek = await peekFirstCommandCodeFrame(
      makeResponse([JSON.stringify({ type: "start" }), JSON.stringify({ type: "text-delta", text: "Hi" })])
    );
    expect(peek.isError).toBe(false);
  });
});

describe("wrapNdjsonAsOpenAISse on healthy stream", () => {
  it("translates NDJSON to OpenAI SSE chunks", async () => {
    const resp = makeResponse([
      JSON.stringify({ type: "start" }),
      JSON.stringify({ type: "text-delta", text: "Hello" }),
      JSON.stringify({ type: "finish", totalUsage: { inputTokens: 1, outputTokens: 1 } }),
    ]);
    const peek = await peekFirstCommandCodeFrame(resp);
    const wrapped = await wrapNdjsonAsOpenAISse("cmdcc/model", peek.consumed, peek.reader);
    expect(wrapped.ok).toBe(true);
    const out = await wrapped.text();
    expect(out).toContain('"content":"Hello"');
    expect(out).toContain("data: [DONE]");
  });
});