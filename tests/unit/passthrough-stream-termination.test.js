// Regression: passthrough mode (sourceFormat === targetFormat) must not
// double-emit the OpenAI [DONE] sentinel, and must not present a truncated
// upstream stream as a clean success.
//
// Previously streamDoneSent was only maintained in translate mode, so the
// flush always appended its own [DONE] even when the upstream had already sent
// one, and a stream cut before any finish_reason ended with a bare [DONE] that
// looked like a normal completion.
import { describe, expect, it } from "vitest";
import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";

function upstreamResponse(body) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream" } });
}

async function collect(rs) {
  const reader = rs.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

const countDone = (s) => (s.match(/data: \[DONE\]/g) || []).length;

describe("passthrough stream termination", () => {
  it("does not duplicate [DONE] when the upstream already sent one", async () => {
    const body =
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n' +
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
      "data: [DONE]\n\n";
    const ts = createPassthroughStreamWithLogger("openai", null, "m", null, { messages: [] });
    const text = await collect(upstreamResponse(body).body.pipeThrough(ts));
    expect(countDone(text)).toBe(1);
  });

  it("emits a synthetic finish before [DONE] when the upstream truncates", async () => {
    // Content arrives, then the stream ends with no finish_reason and no [DONE].
    const body = 'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n';
    const ts = createPassthroughStreamWithLogger("openai", null, "m", null, { messages: [] });
    const text = await collect(upstreamResponse(body).body.pipeThrough(ts));
    expect(countDone(text)).toBe(1);
    // A finishing chunk must precede the sentinel so the client sees completion.
    const finishIdx = text.indexOf('"finish_reason":"stop"');
    const doneIdx = text.indexOf("data: [DONE]");
    expect(finishIdx).toBeGreaterThanOrEqual(0);
    expect(finishIdx).toBeLessThan(doneIdx);
  });
});
