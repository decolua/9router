// #4356: an OpenAI-compatible client (Cline) streaming through a translated
// route got the final chunk with finish_reason:"stop" and then the socket
// closed — no `data: [DONE]`. The AI SDK waits for that sentinel, so the
// request hangs until timeout and then reports a stream error.
//
// The sentinel was only emitted on two paths: passthrough mode (no
// translation), and the Responses→Responses same-format case. Any translated
// route into an OpenAI client — gemini→openai is the reported one — finished
// without it.
import { describe, expect, it } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";

async function drain(input, targetFormat, sourceFormat, provider) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(input));
      controller.close();
    },
  });

  const output = stream.pipeThrough(
    createSSETransformStreamWithLogger(targetFormat, sourceFormat, provider, null, null, "test-model"),
  );

  const reader = output.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

const geminiChunk = (text, finish) => `data: ${JSON.stringify({
  candidates: [{
    content: { role: "model", parts: [{ text }] },
    ...(finish ? { finishReason: "STOP" } : {}),
  }],
  ...(finish ? { usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 7, totalTokenCount: 18 } } : {}),
})}\n\n`;

const doneFrames = (sse) => sse.split("\n").filter((l) => l.trim() === "data: [DONE]");

describe("translated OpenAI streams terminate with [DONE] (#4356)", () => {
  it("emits the sentinel for a gemini upstream translated to an OpenAI client", async () => {
    const out = await drain(
      geminiChunk("TEST") + geminiChunk("", true),
      FORMATS.GEMINI,
      FORMATS.OPENAI,
      "gemini",
    );
    expect(out).toContain('"finish_reason":"stop"');
    expect(doneFrames(out)).toHaveLength(1);
  });

  it("puts the sentinel last, after the finish chunk", async () => {
    const out = await drain(
      geminiChunk("TEST") + geminiChunk("", true),
      FORMATS.GEMINI,
      FORMATS.OPENAI,
      "gemini",
    );
    const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
    expect(lines.at(-1)).toBe("data: [DONE]");
  });

  it("does not duplicate the sentinel when upstream already sent one", async () => {
    const out = await drain(
      geminiChunk("TEST") + geminiChunk("", true) + "data: [DONE]\n\n",
      FORMATS.GEMINI,
      FORMATS.OPENAI,
      "gemini",
    );
    expect(doneFrames(out)).toHaveLength(1);
  });

  it("still does not send the sentinel to a Gemini client, which rejects it", async () => {
    const out = await drain(
      geminiChunk("TEST") + geminiChunk("", true),
      FORMATS.GEMINI,
      FORMATS.GEMINI,
      "gemini",
    );
    expect(doneFrames(out)).toHaveLength(0);
  });

  it("still does not send the sentinel to a Claude client, which uses event: frames", async () => {
    const out = await drain(
      geminiChunk("TEST") + geminiChunk("", true),
      FORMATS.GEMINI,
      FORMATS.CLAUDE,
      "gemini",
    );
    expect(doneFrames(out)).toHaveLength(0);
  });
});
