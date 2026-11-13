import { describe, expect, it } from "vitest";
import { transformToOllama } from "../../open-sse/utils/ollamaTransform.js";

// /api/chat serves 9router's Ollama-compatible surface: it takes the upstream
// OpenAI SSE stream and re-emits it as Ollama NDJSON.
function upstream(chunks) {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({
    start(c) {
      for (const chunk of chunks) c.enqueue(typeof chunk === "string" ? enc.encode(chunk) : chunk);
      c.close();
    },
  }), { status: 200 });
}

async function ndjson(response) {
  const reader = response.body.getReader();
  const dec = new TextDecoder();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += dec.decode(value, { stream: true });
  }
  text += dec.decode();
  return text.split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

const sse = (payload) => `data: ${JSON.stringify(payload)}\n`;
const delta = (content) => sse({ choices: [{ delta: { content } }] });
const finish = (reason) => sse({ choices: [{ delta: {}, finish_reason: reason } ] });

describe("Ollama-compatible stream: text", () => {
  it("survives a multi-byte character split across two network chunks", async () => {
    const bytes = new TextEncoder().encode(delta("xin chào 世界"));
    const cut = bytes.indexOf(0xe4); // first byte of 世
    const out = await ndjson(transformToOllama(
      upstream([bytes.slice(0, cut + 1), bytes.slice(cut + 1), finish("stop"), "data: [DONE]\n"]),
      "m",
    ));
    // Decoding each chunk separately turned 世 into three replacement characters.
    expect(out[0].message.content).toBe("xin chào 世界");
  });

  it("ends the stream with exactly one done:true", async () => {
    const out = await ndjson(transformToOllama(
      upstream([delta("hi"), finish("stop"), "data: [DONE]\n"]),
      "m",
    ));
    expect(out.filter((m) => m.done).length).toBe(1);
    expect(out.at(-1)).toEqual({ model: "m", message: { role: "assistant", content: "" }, done: true });
  });

  it("delivers a content line that arrived without its newline", async () => {
    const out = await ndjson(transformToOllama(
      upstream([delta("hello"), delta(" world").trimEnd()]),
      "m",
    ));
    expect(out.filter((m) => !m.done).map((m) => m.message.content).join("")).toBe("hello world");
  });
});

describe("Ollama-compatible stream: tool calls", () => {
  it("keeps the tool calls on the one terminal message", async () => {
    const out = await ndjson(transformToOllama(upstream([
      sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "get_weather", arguments: '{"city":' } }] } }] }),
      sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"Hanoi"}' } }] } }] }),
      finish("tool_calls"),
      "data: [DONE]\n",
    ]), "m"));

    const terminal = out.filter((m) => m.done);
    // The tool-call message used to be followed by two empty done:true lines, so
    // a client that keeps the last terminal message lost the call.
    expect(terminal.length).toBe(1);
    expect(terminal[0].message.tool_calls).toEqual([
      { function: { name: "get_weather", arguments: { city: "Hanoi" } } },
    ]);
  });
});
