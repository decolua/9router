import { describe, expect, it } from "vitest";

import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";

// NaN sends its usage trailer after finish_reason as choices:[{index:0,delta:{}}]
// (not choices:[]). The empty-delta filter used to drop it before usage was read,
// so the stored usage was the estimate and cached tokens were always 0.
async function run(lines) {
  const encoder = new TextEncoder();
  const input = new ReadableStream({
    start(c) {
      c.enqueue(encoder.encode(lines.map((l) => `data: ${typeof l === "string" ? l : JSON.stringify(l)}\n\n`).join("")));
      c.close();
    },
  });
  let final = null;
  const out = input.pipeThrough(createPassthroughStreamWithLogger("nan", null, "glm5.3-flash", null,
    { messages: [{ role: "user", content: "hi" }] }, (_content, usage) => { final = usage; }));
  const text = await new Response(out).text();
  return { text, final };
}

const base = { id: "x", object: "chat.completion.chunk", created: 1, model: "glm5.3-flash" };
const trailerUsage = { prompt_tokens: 7374, completion_tokens: 8, total_tokens: 7382, prompt_tokens_details: { cached_tokens: 7360 } };

describe("passthrough stream: usage trailer with an empty delta", () => {
  it("records the real trailer (with cached tokens) instead of the estimate", async () => {
    const { text, final } = await run([
      { ...base, choices: [{ index: 0, delta: { role: "assistant", content: "OK" } }] },
      { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      { ...base, choices: [{ index: 0, delta: {} }], usage: trailerUsage },
      "[DONE]",
    ]);
    expect(final.estimated).toBeUndefined();
    expect(final.prompt_tokens).toBe(7374);
    expect(final.cached_tokens ?? final.prompt_tokens_details?.cached_tokens).toBe(7360);
    expect(text).toContain('"cached_tokens":7360');
  });

  it("still drops empty deltas that carry no usage", async () => {
    const { text } = await run([
      { ...base, choices: [{ index: 0, delta: { content: "OK" } }] },
      { ...base, choices: [{ index: 0, delta: {} }] },
      { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: trailerUsage },
      "[DONE]",
    ]);
    expect(text.split("\n").filter((l) => l.startsWith("data: {")).length).toBe(2);
  });
});
