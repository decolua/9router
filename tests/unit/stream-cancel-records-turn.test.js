// #3488 — a client that hangs up mid-stream left no trace: no usage row, no
// request detail, nothing in Recent Requests, even though the provider had
// already generated (and been charged for) the partial answer.
//
// createSSEStream recorded the turn from `flush` only. The Streams spec calls
// `flush` when the upstream ends and `cancel` when the readable is cancelled —
// one or the other, never both — so cancelling the reader skipped recording
// entirely. These tests drive the transformer through both endings and assert
// the turn is recorded exactly once either way.

import { describe, it, expect, vi } from "vitest";

import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const encoder = new TextEncoder();

function build(onStreamComplete) {
  return createSSETransformStreamWithLogger(
    FORMATS.OPENAI,
    FORMATS.OPENAI,
    "openai",
    null,
    null,
    "gpt-4o",
    "conn-1",
    { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
    onStreamComplete,
  );
}

// This TransformStream is constructed without a readable queuing strategy, so
// its readable high-water mark is the default 0 and every `writer.write()`
// blocks until something reads. A test that writes and only then reads
// deadlocks — which is what the first two attempts at this file did, five
// seconds at a time. Keep a reader pumping for the whole test instead.
function pump(readable) {
  const reader = readable.getReader();
  const finished = (async () => {
    try {
      for (;;) {
        const { done } = await reader.read();
        if (done) return;
      }
    } catch {
      // cancel() rejects the pending read; that is the path under test.
    }
  })();
  return { reader, finished };
}

const DELTA = 'data: {"choices":[{"delta":{"content":"partial answer"}}]}';
const BLANK = String.fromCharCode(10, 10);
const partial = DELTA + BLANK;
const done = "data: [DONE]" + BLANK;

describe("a stream cancelled mid-answer still records the turn (#3488)", () => {
  it("records when the client goes away before any terminal event", async () => {
    const onStreamComplete = vi.fn();
    const transform = build(onStreamComplete);

    const { reader } = pump(transform.readable);
    const writer = transform.writable.getWriter();
    await writer.write(encoder.encode(partial));

    // The client goes away. Cancelling the readable is what the response close
    // does, and it is why `flush` never runs on this path.
    await reader.cancel("client-hangup");

    expect(onStreamComplete).toHaveBeenCalledTimes(1);
    const [content] = onStreamComplete.mock.calls[0];
    expect(content.content).toContain("partial answer");
  });

  it("still records exactly once when the upstream ends normally", async () => {
    const onStreamComplete = vi.fn();
    const transform = build(onStreamComplete);

    const { finished } = pump(transform.readable);
    const writer = transform.writable.getWriter();
    await writer.write(encoder.encode(partial));
    await writer.close();
    await finished;

    expect(onStreamComplete).toHaveBeenCalledTimes(1);
  });

  it("does not record twice when the client closes after the answer completed", async () => {
    const onStreamComplete = vi.fn();
    const transform = build(onStreamComplete);

    const { reader } = pump(transform.readable);
    const writer = transform.writable.getWriter();
    await writer.write(encoder.encode(partial));
    await writer.write(encoder.encode(done));

    // finalizeStream() already ran from the terminal event inside transform().
    // A late disconnect must not add a second row.
    //
    // On measuring it: this passes with the `finalized` guard removed too, so it
    // does not pin that guard. It cannot — once transform() has seen [DONE] the
    // readable is already closed, so cancel() is never invoked and there is no
    // second call to suppress. What it does pin is the user-visible property,
    // which a future cancel path that fires unconditionally would break.
    await reader.cancel("client-hangup");

    expect(onStreamComplete).toHaveBeenCalledTimes(1);
  });
});
