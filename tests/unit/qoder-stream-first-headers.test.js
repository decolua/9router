// A 300K-token prompt keeps upstream silent for 10-40s before the first byte.
// Streaming clients give up on an idle socket, so execute() must hand back a
// live SSE stream once its headers budget expires and finish the work behind it.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { QoderExecutor } from "../../open-sse/executors/qoder.js";

const CHUNK = `data: ${JSON.stringify({
  id: "c1", object: "chat.completion.chunk", created: 1, model: "smodel",
  choices: [{ index: 0, delta: { content: "late-token" }, finish_reason: null }],
})}\n\ndata: [DONE]\n\n`;

function slowExecutor(delayMs, { ok = true, status = 200, body = CHUNK } = {}) {
  const ex = new QoderExecutor("qoder");
  ex._executeAttempt = () =>
    new Promise((resolve) =>
      setTimeout(() => resolve({ response: new Response(body, { status }), url: "u", headers: {}, transformedBody: {} }), delayMs),
    );
  return ex;
}

describe("QoderExecutor stream-first", () => {
  beforeEach(() => { process.env.QODER_HEADERS_BUDGET_MS = "50"; });
  afterEach(() => { delete process.env.QODER_HEADERS_BUDGET_MS; });

  it("answers with heartbeats instead of going silent past the budget", async () => {
    const ex = slowExecutor(400);
    const started = Date.now();
    const out = await ex.execute({ body: { stream: true, messages: [] }, credentials: {}, log: null });
    expect(Date.now() - started).toBeLessThan(300);
    expect(out.response.status).toBe(200);
    expect(out.response.headers.get("Content-Type")).toBe("text/event-stream");

    const reader = out.response.body.getReader();
    const first = await reader.read();
    const firstAt = Date.now() - started;
    const text = new TextDecoder().decode(first.value);
    expect(firstAt).toBeLessThan(300);
    expect(text).toContain(": qoder-waiting");

    let rest = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      rest += new TextDecoder().decode(value);
    }
    expect(rest).toContain("late-token");
  });

  it("turns a refusal that arrives late into an in-band SSE error", async () => {
    const ex = slowExecutor(300, { ok: false, status: 429, body: JSON.stringify({ error: { message: "quota exceeded" } }) });
    const out = await ex.execute({ body: { stream: true, messages: [] }, credentials: {}, log: null });
    let all = "";
    const reader = out.response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      all += new TextDecoder().decode(value);
    }
    expect(all).toContain("quota exceeded");
    expect(all).toContain("[DONE]");
  });

  it("keeps the old path for non-streaming requests", async () => {
    const ex = slowExecutor(120, { ok: false, status: 429, body: JSON.stringify({ error: { message: "quota exceeded" } }) });
    const out = await ex.execute({ body: { stream: false, messages: [] }, credentials: {}, log: null });
    expect(out.response.status).toBe(429);
  });
});
