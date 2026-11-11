// Regression for #5592 — an openai passthrough stream whose upstream ends with an
// unterminated "data: [DONE]" (no trailing newline) was forwarded raw and then
// followed by the sentinel flush() appends, producing "data: [DONE]data: [DONE]".
import { describe, it, expect } from "vitest";

import { createSSEStream } from "../../open-sse/utils/stream.js";

const chunk = JSON.stringify({
  id: "chatcmpl-abc12345",
  object: "chat.completion.chunk",
  created: 1700000000,
  model: "m",
  choices: [{ index: 0, delta: { content: "hi" }, finish_reason: null }],
});

async function run(sse) {
  const stream = createSSEStream({ mode: "passthrough", provider: "openai" });
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const decoder = new TextDecoder();
  const readPromise = (async () => {
    let out = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out += decoder.decode(value, { stream: true });
    }
    return out;
  })();
  await writer.write(new TextEncoder().encode(sse));
  await writer.close();
  return readPromise;
}

const count = (s) => s.split("data: [DONE]").length - 1;

describe("passthrough [DONE] sentinel", () => {
  it("emits one properly framed sentinel when upstream's has no trailing newline", async () => {
    const out = await run(`data: ${chunk}\n\ndata: [DONE]`);
    expect(count(out)).toBe(1);
    expect(out).not.toContain("[DONE]data:");
    expect(out.endsWith("data: [DONE]\n\n")).toBe(true);
  });

  it("emits one sentinel when upstream's is fully terminated", async () => {
    const out = await run(`data: ${chunk}\n\ndata: [DONE]\n\n`);
    expect(count(out)).toBe(1);
    expect(out.endsWith("data: [DONE]\n\n")).toBe(true);
  });

  it("still appends a sentinel when upstream sent none", async () => {
    const out = await run(`data: ${chunk}\n\n`);
    expect(count(out)).toBe(1);
  });
});
