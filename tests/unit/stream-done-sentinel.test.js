import { describe, expect, it } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";

// #4356: a /v1/chat/completions streaming response closed after the final chunk
// without the `data: [DONE]` terminal frame. Strict OpenAI clients read that as
// a truncated stream — Cline's AI SDK raised "Response stream ended without a
// finish reason" and failed the whole run.
//
// The sentinel was only emitted for the Responses passthrough shape, so every
// other target (plain chat completions, including via a translating or
// passthrough upstream) got a bare close.

async function runSse(targetFormat, sourceFormat, provider, input) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(input));
      controller.close();
    },
  });
  const output = stream.pipeThrough(
    createSSETransformStreamWithLogger(targetFormat, sourceFormat, provider, null, null, "m"),
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

const DONE = "data: [DONE]\n\n";
const countDone = (s) => (s.match(/data: \[DONE\]/g) || []).length;

const GEMINI_SSE =
  'data: {"candidates":[{"content":{"parts":[{"text":"TEST"}],"role":"model"},"index":0}],"modelVersion":"gemini-3.8-flash","usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":2,"totalTokenCount":7}}\n\n';

const OPENAI_SSE =
  'data: {"id":"1","object":"chat.completion.chunk","model":"gpt-4o","choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":null}]}\n\n' +
  'data: {"id":"1","object":"chat.completion.chunk","model":"gpt-4o","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n' +
  'data: [DONE]\n\n';

const OLLAMA_NDJSON =
  JSON.stringify({ model: "gpt-oss:120b", message: { role: "assistant", content: "hi" }, done: true, done_reason: "stop", prompt_eval_count: 5, eval_count: 2 }) + "\n";

describe("streaming terminates with [DONE] for OpenAI clients (#4356)", () => {
  it("emits [DONE] for a Gemini upstream → chat completions client", async () => {
    const out = await runSse(FORMATS.OPENAI, FORMATS.GEMINI, "gemini", GEMINI_SSE);
    expect(out).toContain(DONE);
  });

  it("emits [DONE] for an Ollama upstream → chat completions client", async () => {
    const out = await runSse(FORMATS.OPENAI, FORMATS.OLLAMA, "ollama", OLLAMA_NDJSON);
    expect(out).toContain(DONE);
  });

  it("emits exactly one [DONE] when upstream also sent one", async () => {
    // Upstream's sentinel is consumed, not forwarded; the client still needs its
    // own terminal frame.
    const out = await runSse(FORMATS.OPENAI, FORMATS.OPENAI, "openai", OPENAI_SSE);
    expect(countDone(out)).toBe(1);
  });

  it("emits exactly one [DONE] when upstream did not send one", async () => {
    expect(countDone(await runSse(FORMATS.OPENAI, FORMATS.GEMINI, "gemini", GEMINI_SSE))).toBe(1);
  });

  it("emits [DONE] for a Claude upstream → chat completions client", async () => {
    const claudeSSE =
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}\n\n' +
      'event: message_stop\ndata: {"type":"message_stop"}\n\n';
    const out = await runSse(FORMATS.OPENAI, FORMATS.CLAUDE, "anthropic", claudeSSE);
    expect(out).toContain(DONE);
  });

  it("emits [DONE] for the Responses target too", async () => {
    const out = await runSse(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "openai", OPENAI_SSE);
    expect(out).toContain(DONE);
  });

  it("does NOT send the OpenAI sentinel to a Gemini-family client", async () => {
    // Gemini/Antigravity/Vertex reject `data: [DONE]` with a 400 syntax error,
    // so the sentinel is scoped to OpenAI-family targets only.
    for (const target of [FORMATS.GEMINI, FORMATS.ANTIGRAVITY, FORMATS.GEMINI_CLI, FORMATS.VERTEX]) {
      const out = await runSse(target, FORMATS.OPENAI, "gemini", OPENAI_SSE);
      expect(out, target).not.toContain(DONE);
    }
  });

  it("does NOT send the OpenAI sentinel to a Claude client", async () => {
    const out = await runSse(FORMATS.CLAUDE, FORMATS.OPENAI, "anthropic", OPENAI_SSE);
    expect(out).not.toContain(DONE);
  });
});
