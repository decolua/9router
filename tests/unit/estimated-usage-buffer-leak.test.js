// The 2000-token buffer is a margin for the *client's* context arithmetic. On
// the normal path stream.js is explicit about that split -- "Add buffer and
// filter usage for client (but keep original in state.usage for logging)" --
// and the recorded value stays raw.
//
// The estimated path broke it. `estimateUsage()` returned an already-buffered
// object (formatUsage wrapped both shapes in addBufferToUsage), and all three
// call sites in stream.js assigned that same object to the variable that is
// later logged and handed to onStreamComplete. So whenever a provider omitted
// usage, the turn was recorded 2000 input tokens larger than it was --
// silently, and in the direction that inflates a quota.
//
// Found while looking at #3890. The behaviour reported there -- a client seeing
// input_tokens 2000 higher than the provider's -- is the deliberate margin, not
// this defect; these tests pin the accounting side, which is not deliberate.

import { describe, it, expect, vi } from "vitest";

import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";
import { estimateUsage, formatUsage } from "../../open-sse/utils/usageTracking.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const BUFFER_TOKENS = 2000;
const encoder = new TextEncoder();
const BLANK = String.fromCharCode(10, 10);

const BODY = { model: "gpt-4o", messages: [{ role: "user", content: "count to three" }] };

// Passthrough mode: the branch under test is the one that injects an estimate
// into an OpenAI finish chunk that arrived with no usage of its own.
function build(onStreamComplete) {
  return createPassthroughStreamWithLogger("openai", null, "gpt-4o", "conn-1", BODY, onStreamComplete);
}

// Same reason as stream-cancel-records-turn.test.js: no readable queuing
// strategy means high-water mark 0, so a write blocks until something reads.
// Collect while pumping instead of reading afterwards.
function pump(readable, sink) {
  const reader = readable.getReader();
  const decoder = new TextDecoder();
  const finished = (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        sink.push(decoder.decode(value, { stream: true }));
      }
    } catch {
      /* not the path under test here */
    }
  })();
  return finished;
}

describe("estimateUsage keeps the client margin out of the recorded turn", () => {
  it("still buffers by default, so callers that emit it are unchanged", () => {
    // open-sse/executors/cursor.js puts this straight on a response body.
    const raw = formatUsage(100, 10, FORMATS.OPENAI, { buffer: false });
    const buffered = formatUsage(100, 10, FORMATS.OPENAI);
    expect(raw.prompt_tokens).toBe(100);
    expect(buffered.prompt_tokens).toBe(100 + BUFFER_TOKENS);
    expect(buffered.total_tokens).toBe(raw.total_tokens + BUFFER_TOKENS);
  });

  it("honours the opt-out in the Claude shape too", () => {
    const raw = formatUsage(100, 10, FORMATS.CLAUDE, { buffer: false });
    const buffered = formatUsage(100, 10, FORMATS.CLAUDE);
    expect(raw.input_tokens).toBe(100);
    expect(buffered.input_tokens).toBe(100 + BUFFER_TOKENS);
    // Output is never buffered in either shape.
    expect(raw.output_tokens).toBe(10);
    expect(buffered.output_tokens).toBe(10);
  });

  it("estimateUsage forwards the option rather than swallowing it", () => {
    const raw = estimateUsage(BODY, 40, FORMATS.OPENAI, { buffer: false });
    const buffered = estimateUsage(BODY, 40, FORMATS.OPENAI);
    expect(buffered.prompt_tokens - raw.prompt_tokens).toBe(BUFFER_TOKENS);
  });

  // The wiring. Everything above passes with the three stream.js call sites
  // reverted, because they would simply keep asking for the buffered default.
  it("records the raw estimate while the client still receives the buffered one", async () => {
    const onStreamComplete = vi.fn();
    const transform = build(onStreamComplete);
    const chunks = [];
    const finished = pump(transform.readable, chunks);
    const writer = transform.writable.getWriter();

    // Content, then a finish chunk carrying no usage at all: the case that
    // makes stream.js estimate.
    await writer.write(
      encoder.encode('data: {"choices":[{"delta":{"content":"one two three"}}]}' + BLANK),
    );
    await writer.write(encoder.encode('data: {"choices":[{"finish_reason":"stop"}]}' + BLANK));
    await writer.write(encoder.encode("data: [DONE]" + BLANK));
    await writer.close();
    await finished;

    expect(onStreamComplete).toHaveBeenCalled();
    const recorded = onStreamComplete.mock.calls[0][1];
    expect(recorded, "the turn should be recorded with a usage object").toBeTruthy();

    const emitted = chunks.join("");
    const withUsage = emitted
      .split(String.fromCharCode(10))
      .filter((line) => line.startsWith("data: ") && line.includes('"usage"'))
      .map((line) => JSON.parse(line.slice(6)));
    expect(withUsage.length, "the client should have been sent a usage object").toBeGreaterThan(0);
    const sent = withUsage[withUsage.length - 1].usage;

    // Both numbers describe the same turn; they must differ by exactly the
    // client margin, with the smaller one being what we record.
    expect(sent.prompt_tokens - recorded.prompt_tokens).toBe(BUFFER_TOKENS);
    expect(recorded.prompt_tokens).toBeGreaterThan(0);
  });
});
