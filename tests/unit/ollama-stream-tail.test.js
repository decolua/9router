import { describe, expect, it } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";

// Ollama streams NDJSON — one raw JSON object per line, no "data: " prefix.
// Whatever arrives without a closing newline stays in the line buffer and is
// only parsed when the transform flushes.
async function runOllamaStream(input) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(input));
      controller.close();
    },
  });

  const output = stream.pipeThrough(
    createSSETransformStreamWithLogger(FORMATS.OLLAMA, FORMATS.OPENAI, "ollama", null, null, "gpt-oss:120b"),
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

const chunk = (content, done = false) => JSON.stringify({
  model: "gpt-oss:120b",
  created_at: "2026-08-25T00:00:00Z",
  message: { role: "assistant", content },
  done,
  ...(done ? { done_reason: "stop", prompt_eval_count: 11, eval_count: 7 } : {}),
});

const deltas = (sse) => sse
  .split("\n")
  .filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
  .map((l) => JSON.parse(l.slice(6)));

describe("Ollama NDJSON stream: the tail left in the line buffer", () => {
  it("delivers a content chunk that arrived without its newline", async () => {
    const out = await runOllamaStream([chunk("hello"), chunk(" world")].join("\n"));
    const content = deltas(out).map((c) => c.choices?.[0]?.delta?.content || "").join("");
    expect(content).toBe("hello world");
  });

  it("delivers the final chunk — finish_reason and usage — when it arrives without its newline", async () => {
    const out = await runOllamaStream([chunk("hello"), chunk("", true)].join("\n"));
    const last = deltas(out).at(-1);
    expect(last.choices[0].finish_reason).toBe("stop");
    expect(last.usage).toEqual({ prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 });
  });

  it("is unchanged when every line is newline-terminated", async () => {
    const out = await runOllamaStream(`${[chunk("hello"), chunk(" world"), chunk("", true)].join("\n")}\n`);
    const parsed = deltas(out);
    expect(parsed.map((c) => c.choices?.[0]?.delta?.content || "").join("")).toBe("hello world");
    expect(parsed.at(-1).choices[0].finish_reason).toBe("stop");
    expect(parsed.at(-1).usage.total_tokens).toBe(18);
  });
});

describe("SSE providers keep their sentinel handling", () => {
  it("does not translate a trailing data: [DONE]", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({ choices: [{ delta: { content: "hi" } }] })}\ndata: [DONE]`,
        ));
        controller.close();
      },
    });
    const out = stream.pipeThrough(
      createSSETransformStreamWithLogger(FORMATS.OPENAI, FORMATS.OPENAI, "openai", null, null, "gpt-4o"),
    );
    const reader = out.getReader();
    const decoder = new TextDecoder();
    let text = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    expect(text).toContain('"content":"hi"');
    // The sentinel is a framing marker, not a chunk — it must not be translated.
    expect(text).not.toContain('"done":true');
  });
});
