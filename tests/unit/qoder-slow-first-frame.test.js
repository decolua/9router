// A 300K-token prompt can sit ~40s before the model emits its first token.
// wrapQoderSSE used to block on the first upstream frame (to turn refusals into
// an HTTP status), which left streaming clients with zero bytes for that whole
// window — they time out and the user sees "no response". It must now emit an
// SSE comment within the peek budget and keep the socket warm.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { __test__ } from "../../open-sse/executors/qoder.js";

const { wrapQoderSSE } = __test__;

const FRAME = `data: ${JSON.stringify({
  statusCodeValue: 200,
  body: JSON.stringify({
    id: "chunk-1",
    object: "chat.completion.chunk",
    created: 1700000000,
    model: "smodel",
    choices: [{ index: 0, delta: { content: "hello" }, finish_reason: null }],
  }),
})}\n\n`;
const DONE = "data: [DONE]\n\n";

function stalledResponse({ stallMs = 400, frame = FRAME } = {}) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      await new Promise((r) => setTimeout(r, stallMs));
      controller.enqueue(encoder.encode(frame));
      controller.enqueue(encoder.encode(DONE));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

describe("wrapQoderSSE slow first frame", () => {
  beforeEach(() => { process.env.QODER_PEEK_BUDGET_MS = "50"; });
  afterEach(() => { delete process.env.QODER_PEEK_BUDGET_MS; });

  it("keeps the connection warm instead of waiting for the first token", async () => {
    const started = Date.now();
    const res = await wrapQoderSSE(stalledResponse({ stallMs: 600 }), "smodel", null, null);
    const elapsed = Date.now() - started;
    expect(res.status).toBe(200);

    const reader = res.body.getReader();
    const first = await reader.read();
    const firstAt = Date.now() - started;
    const text = new TextDecoder().decode(first.value);

    // First bytes must land on the peek budget, not on the upstream stall.
    expect(firstAt).toBeLessThan(400);
    expect(elapsed).toBeLessThan(400);
    expect(text).toContain(": qoder-waiting");

    // The real content still arrives afterwards.
    let rest = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      rest += new TextDecoder().decode(value);
    }
    expect(rest).toContain("hello");
  });

  it("still surfaces an immediate error envelope as an HTTP status", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ statusCodeValue: 401, body: "unauthorized" })}\n\n`));
        controller.close();
      },
    });
    const res = await wrapQoderSSE(new Response(body, { status: 200 }), "smodel", null, null);
    expect(res.status).toBe(401);
  });
});
