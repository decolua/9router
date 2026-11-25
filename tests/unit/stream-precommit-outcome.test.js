import { describe, expect, it } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { createPrecommitStream } from "../../open-sse/utils/streamHandler.js";
import { createStreamingOutcomeTracker } from "../../open-sse/utils/upstreamOutcome.js";

const encoder = new TextEncoder();

function responseFromChunks(chunks, error = null) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      if (error) controller.error(error);
      else controller.close();
    },
  }), { headers: { "Content-Type": "text/event-stream" } });
}

describe("stream precommit outcome barrier", () => {
  it("returns a routable failure for an error event before useful output", async () => {
    const tracker = createStreamingOutcomeTracker({ format: FORMATS.OPENAI });
    const response = responseFromChunks([
      `data: ${JSON.stringify({ error: { message: "overloaded" } })}\n\n`,
    ]);

    const result = await createPrecommitStream(response, tracker, { stallTimeoutMs: 1000 });
    expect(result.ok).toBe(false);
    expect(result.outcome).toMatchObject({
      state: "retryable_precommit_failure",
      errorKind: "upstream_payload_error",
      fallbackAllowed: true,
    });
  });

  it("commits after a one-character output without waiting for EOF", async () => {
    const tracker = createStreamingOutcomeTracker({ format: FORMATS.OPENAI });
    const response = responseFromChunks([
      `data: ${JSON.stringify({ choices: [{ delta: { content: "x" }, finish_reason: null }] })}\n\n`,
    ]);

    const result = await createPrecommitStream(response, tracker, { stallTimeoutMs: 1000 });
    expect(result.ok).toBe(true);
    expect(result.outcome).toMatchObject({ downstreamCommitted: true, usefulOutputSeen: true });
  });

  it("routes a terminal-only stream to fallback without committing downstream", async () => {
    const tracker = createStreamingOutcomeTracker({ format: FORMATS.OPENAI });
    const response = responseFromChunks([
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
    ]);

    const result = await createPrecommitStream(response, tracker, { stallTimeoutMs: 1000 });
    expect(result.ok).toBe(false);
    expect(result.outcome).toMatchObject({ state: "retryable_precommit_failure", errorKind: "empty_upstream_response", fallbackAllowed: true, downstreamCommitted: false });
  });

  it("rejects EOF without output or a terminal", async () => {
    const tracker = createStreamingOutcomeTracker({ format: FORMATS.OPENAI });
    const response = responseFromChunks([`: keepalive\n\n`]);

    const result = await createPrecommitStream(response, tracker, { stallTimeoutMs: 1000 });
    expect(result.ok).toBe(false);
    expect(result.outcome.errorKind).toBe("upstream_incomplete");
  });

  it("classifies a transport reset before commit", async () => {
    const tracker = createStreamingOutcomeTracker({ format: FORMATS.OPENAI });
    const reset = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    const response = responseFromChunks([`: metadata\n\n`], reset);

    const result = await createPrecommitStream(response, tracker, { stallTimeoutMs: 1000 });
    expect(result.ok).toBe(false);
    expect(result.outcome.errorKind).toBe("upstream_reset");
  });
});
