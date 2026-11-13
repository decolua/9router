import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {})
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const {
  splitChunkedContent,
  normalizeChunkedContent
} = await import("../../open-sse/translator/concerns/reasoning.js");
const { parseSSEToOpenAIResponse } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");
const { createSSEStream } = await import("../../open-sse/utils/stream.js");

// Mistral reasoning models stream `content` as a list of chunks instead of a
// plain string (regression: clients saw one closed thinking block per delta).
const thinkingDelta = (text) => ({
  index: 0,
  delta: { content: [{ type: "thinking", thinking: [{ type: "text", text }], closed: true }] },
  finish_reason: null
});
const textDelta = (text) => ({
  index: 0,
  delta: { content: [{ type: "text", text }] },
  finish_reason: null
});

function mistralSSE() {
  const base = { id: "chatcmpl-mistral-test", object: "chat.completion.chunk", created: 123, model: "mistral-medium-3.5" };
  const line = (choice) => `data: ${JSON.stringify({ ...base, choices: [choice] })}\n\n`;
  return [
    line({ index: 0, delta: { role: "assistant" }, finish_reason: null }),
    line(thinkingDelta("User")),
    line(thinkingDelta(" asks: hi")),
    line(textDelta("Hello!")),
    line({ index: 0, delta: {}, finish_reason: "stop" }),
    "data: [DONE]\n\n"
  ].join("");
}

async function runStream(stream, sseText) {
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let out = "";
  const readAll = (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      out += decoder.decode(value, { stream: true });
    }
  })();
  await writer.write(encoder.encode(sseText));
  await writer.close();
  await readAll;
  return out;
}

function parseSSEOutput(out) {
  return out.split("\n")
    .filter((l) => l.startsWith("data: ") && l.slice(6).trim() !== "[DONE]")
    .map((l) => JSON.parse(l.slice(6)));
}

describe("splitChunkedContent / normalizeChunkedContent", () => {
  it("splits thinking chunks (list of text parts) and text chunks", () => {
    const split = splitChunkedContent([
      { type: "thinking", thinking: [{ type: "text", text: "Think " }, { type: "text", text: "a lot" }], closed: true },
      { type: "text", text: "Answer" }
    ]);
    expect(split).toEqual({ text: "Answer", thinking: "Think a lot" });
  });

  it("accepts a string thinking payload and plain-string entries", () => {
    const split = splitChunkedContent([
      { type: "thinking", thinking: "Reasoning" },
      "plain"
    ]);
    expect(split).toEqual({ text: "plain", thinking: "Reasoning" });
  });

  it("returns null for non-chunk-list content", () => {
    expect(splitChunkedContent("plain string")).toBeNull();
    expect(splitChunkedContent(null)).toBeNull();
  });

  it("rewrites a delta: string content + reasoning_content, appended to existing reasoning", () => {
    const delta = {
      content: [{ type: "thinking", thinking: [{ type: "text", text: " more" }] }],
      reasoning_content: "existing"
    };
    expect(normalizeChunkedContent(delta)).toBe(true);
    expect(delta.content).toBe("");
    expect(delta.reasoning_content).toBe("existing more");
  });

  it("leaves standard string-content deltas untouched", () => {
    const delta = { content: "hello" };
    expect(normalizeChunkedContent(delta)).toBe(false);
    expect(delta.content).toBe("hello");
    expect(delta.reasoning_content).toBeUndefined();
  });
});

describe("Mistral chunked content through the SSE-to-JSON aggregator", () => {
  it("accumulates thinking chunks into reasoning_content and text chunks into content", () => {
    const parsed = parseSSEToOpenAIResponse(mistralSSE(), "mistral");
    const message = parsed.choices[0].message;
    expect(message.content).toBe("Hello!");
    expect(message.reasoning_content).toBe("User asks: hi");
  });
});

describe("Mistral chunked content through the passthrough stream", () => {
  it("normalizes chunk deltas to string content + reasoning_content for OpenAI clients", async () => {
    const stream = createSSEStream({ mode: "passthrough", provider: "mistral", model: "mistral-medium-3.5" });
    const chunks = parseSSEOutput(await runStream(stream, mistralSSE()));
    const deltas = chunks.map((c) => c.choices[0].delta);
    expect(deltas.some((d) => d.reasoning_content === "User")).toBe(true);
    expect(deltas.some((d) => d.reasoning_content === " asks: hi")).toBe(true);
    expect(deltas.some((d) => d.content === "Hello!")).toBe(true);
    for (const d of deltas) {
      expect(typeof d.content).not.toBe("object");
    }
  });
});

describe("Mistral chunked content through the openai→claude translate stream", () => {
  it("emits one accumulated thinking block, then a text block", async () => {
    const stream = createSSEStream({
      mode: "translate",
      targetFormat: FORMATS.OPENAI,
      sourceFormat: FORMATS.CLAUDE,
      provider: "mistral",
      model: "mistral-medium-3.5"
    });
    const out = await runStream(stream, mistralSSE());
    const events = out.split("\n")
      .filter((l) => l.startsWith("data: "))
      .map((l) => JSON.parse(l.slice(6)));

    const starts = events.filter((e) => e.type === "content_block_start");
    expect(starts.map((e) => e.content_block.type)).toEqual(["thinking", "text"]);

    const thinking = events
      .filter((e) => e.type === "content_block_delta" && e.delta.type === "thinking_delta")
      .map((e) => e.delta.thinking)
      .join("");
    expect(thinking).toBe("User asks: hi");

    const text = events
      .filter((e) => e.type === "content_block_delta" && e.delta.type === "text_delta")
      .map((e) => e.delta.text)
      .join("");
    expect(text).toBe("Hello!");

    // Each block is stopped exactly once, after its deltas — no per-delta blocks.
    const stops = events.filter((e) => e.type === "content_block_stop");
    expect(stops).toHaveLength(2);
    expect(events.at(-1).type).toBe("message_stop");
  });
});
