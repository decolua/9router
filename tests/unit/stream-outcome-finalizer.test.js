import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  trackPendingRequest: vi.fn(),
}));

import { FORMATS } from "../../open-sse/translator/formats.js";
import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";
import { pipeWithDisconnect } from "../../open-sse/utils/streamHandler.js";
import { createStreamingOutcomeTracker } from "../../open-sse/utils/upstreamOutcome.js";

const encoder = new TextEncoder();

function responseThatResetsAfter(chunk) {
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(chunk));
      const error = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
      controller.error(error);
    },
  }), { headers: { "Content-Type": "text/event-stream" } });
}

function fakeStreamController() {
  let connected = true;
  return {
    signal: new AbortController().signal,
    startTime: Date.now(),
    isConnected: () => connected,
    handleComplete: vi.fn(() => { connected = false; }),
    handleError: vi.fn(() => { connected = false; }),
    handleDisconnect: vi.fn(() => { connected = false; }),
    abort: vi.fn(() => { connected = false; }),
  };
}

describe("stream outcome finalizer", () => {
  it("records finish-then-reset as committed failure without estimated usage", async () => {
    const tracker = createStreamingOutcomeTracker({ format: FORMATS.OPENAI, committed: true });
    tracker.observe({
      data: { choices: [{ delta: { content: "x" }, finish_reason: "stop" }] },
    });

    const completed = vi.fn();
    const transform = createPassthroughStreamWithLogger(
      "openai",
      null,
      "test-model",
      null,
      { messages: [{ role: "user", content: "hello" }] },
      completed,
      null,
      null,
      tracker
    );
    const controller = fakeStreamController();
    const body = pipeWithDisconnect(
      responseThatResetsAfter(
        `data: ${JSON.stringify({ choices: [{ delta: { content: "x" }, finish_reason: "stop" }] })}\n\n`
      ),
      transform,
      controller,
      null,
      1000,
      {
        onError(error) {
          tracker.fail(error?.errorKind || "upstream_reset", error?.message);
          transform.finalizeOutcome();
        },
      }
    );

    await new Response(body).text();
    expect(completed).toHaveBeenCalledTimes(1);
    expect(completed.mock.calls[0][1]).toBeNull();
    expect(completed.mock.calls[0][3]).toMatchObject({
      state: "committed_failure",
      errorKind: "upstream_reset",
      fallbackAllowed: false,
    });
  });

  it("records downstream cancellation as client_aborted", async () => {
    const tracker = createStreamingOutcomeTracker({ format: FORMATS.OPENAI, committed: true });
    const completed = vi.fn();
    const transform = createPassthroughStreamWithLogger(
      "openai", null, "test-model", null, null, completed, null, null, tracker
    );
    const controller = fakeStreamController();
    const upstream = new Response(new ReadableStream({
      start(streamController) {
        streamController.enqueue(encoder.encode(
          `data: ${JSON.stringify({ choices: [{ delta: { content: "x" }, finish_reason: null }] })}\n\n`
        ));
      },
    }), { headers: { "Content-Type": "text/event-stream" } });
    const body = pipeWithDisconnect(upstream, transform, controller, null, 1000, {
      onCancel(reason) {
        tracker.abortClient(String(reason || "Client disconnected"));
        transform.finalizeOutcome();
      },
    });

    const reader = body.getReader();
    await reader.read();
    await reader.cancel("client closed");

    expect(completed).toHaveBeenCalledTimes(1);
    expect(completed.mock.calls[0][1]).toBeNull();
    expect(completed.mock.calls[0][3]).toMatchObject({
      state: "client_aborted",
      errorKind: "aborted",
      clientDisconnected: true,
    });
  });
});
