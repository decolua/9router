import { describe, expect, it } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";

// Kiro's integrity gate buffers the whole reply and emits ": kiro-validation"
// comments meanwhile. Translate mode must forward them as keepalives, otherwise
// the client gets no bytes (not even headers) and reverse proxies return 504.
function controlled(targetFormat, sourceFormat) {
  const encoder = new TextEncoder();
  let upstream;
  const input = new ReadableStream({ start(c) { upstream = c; } });
  const reader = input
    .pipeThrough(createSSETransformStreamWithLogger(targetFormat, sourceFormat, "kiro", null, null, "claude-opus-5"))
    .getReader();
  const decoder = new TextDecoder();
  return {
    push: (text) => upstream.enqueue(encoder.encode(text)),
    close: () => upstream.close(),
    read: async () => {
      const { value, done } = await reader.read();
      return done ? null : decoder.decode(value);
    },
    readAll: async () => {
      let out = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return out;
        out += decoder.decode(value, { stream: true });
      }
    },
  };
}

const openaiChunk = (delta, finish = null) => `data: ${JSON.stringify({
  id: "chatcmpl-1",
  object: "chat.completion.chunk",
  created: 1,
  model: "claude-opus-5",
  choices: [{ index: 0, delta, finish_reason: finish }],
})}\n\n`;

describe("translate mode forwards SSE comment heartbeats", () => {
  it("emits a keepalive immediately for a heartbeat that arrives before any content", async () => {
    const s = controlled(FORMATS.KIRO, FORMATS.OPENAI);
    s.push(": kiro-validation\n\n");
    expect(await s.read()).toBe(": keepalive\n\n");
    s.push(": kiro-validation\n\n");
    expect(await s.read()).toBe(": keepalive\n\n");
    s.close();
  });

  it("keeps content intact when heartbeats precede the buffered reply", async () => {
    const s = controlled(FORMATS.KIRO, FORMATS.OPENAI);
    s.push(": kiro-validation\n\n: kiro-validation\n\n");
    s.push(openaiChunk({ role: "assistant", content: "hello" }));
    s.push(openaiChunk({}, "stop"));
    s.push("data: [DONE]\n\n");
    s.close();
    const out = await s.readAll();
    expect(out.match(/^: keepalive$/gm)).toHaveLength(2);
    expect(out).toContain("hello");
    expect(out).toContain('"finish_reason":"stop"');
  });

  it("forwards heartbeats to Claude-format clients too", async () => {
    const s = controlled(FORMATS.KIRO, FORMATS.CLAUDE);
    s.push(": kiro-validation\n\n");
    expect(await s.read()).toBe(": keepalive\n\n");
    s.close();
  });
});
