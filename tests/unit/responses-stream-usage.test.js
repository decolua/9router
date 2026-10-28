// Regression: Responses-format streams must accumulate text so usage estimation
// fires when the upstream omits `usage` (see open-sse/utils/stream.js).
import { describe, it, expect } from "vitest";
import { initTranslators } from "open-sse/translator/index.js";
import { createSSEStream } from "open-sse/utils/stream.js";

async function runStream(events, opts) {
  const sse = events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  let captured;
  const ts = createSSEStream({
    mode: "translate",
    sourceFormat: "openai",
    targetFormat: "openai-responses",
    provider: "codex",
    model: "m",
    body: { messages: [{ role: "user", content: "hi ".repeat(200) }] },
    onStreamComplete: (content, usage) => { captured = { content, usage }; },
    ...opts
  });
  const rs = new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); }
  });
  await rs.pipeThrough(ts).pipeTo(new WritableStream({ write() {} }));
  return captured;
}

describe("openai-responses stream usage", () => {
  it("estimates usage when upstream omits it", async () => {
    await initTranslators();
    const out = await runStream([
      { type: "response.created", response: { id: "r1" } },
      { type: "response.output_item.added", output_index: 0, item: { id: "m1", type: "message", role: "assistant", content: [] } },
      { type: "response.output_text.delta", item_id: "m1", output_index: 0, content_index: 0, delta: "x".repeat(400) },
      { type: "response.completed", response: { id: "r1" } }
    ]);
    expect(out.content.content.length).toBe(400);
    expect(out.usage?.completion_tokens).toBeGreaterThan(0);
  });

  it("prefers real usage from response.completed", async () => {
    await initTranslators();
    const out = await runStream([
      { type: "response.created", response: { id: "r1" } },
      { type: "response.output_text.delta", item_id: "m1", output_index: 0, content_index: 0, delta: "hello" },
      { type: "response.completed", response: { id: "r1", usage: { input_tokens: 111, output_tokens: 22 } } }
    ]);
    expect(out.usage.prompt_tokens).toBe(111);
    expect(out.usage.completion_tokens).toBe(22);
  });
});
