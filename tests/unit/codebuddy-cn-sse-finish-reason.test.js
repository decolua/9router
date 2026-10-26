import { describe, expect, it } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";

const encoder = new TextEncoder();

// Simulates codebuddy-cn upstream SSE: empty-string finish_reason on every chunk, double [DONE]
const CODEBUDDY_CN_SSE = [
  'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":""}]}',
  '',
  'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":""}]}',
  '',
  'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"!"},"finish_reason":""}]}',
  '',
  'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
  '',
  'data: [DONE]',
  '',
  'data: [DONE]',
  '',
];

async function collectStreamOutput(lines) {
  const input = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(lines.join("\n")));
      controller.close();
    },
  });
  const output = input.pipeThrough(createPassthroughStreamWithLogger("codebuddy-cn"));
  const reader = output.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function parseSSEEvents(text) {
  return text
    .split("\n\n")
    .map((block) => {
      const dataMatch = block.match(/^data: (.+)$/m);
      if (!dataMatch) return null;
      const data = dataMatch[1].trim();
      if (data === "[DONE]") return { type: "DONE" };
      try {
        return { type: "CHUNK", data: JSON.parse(data) };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

describe("codebuddy-cn SSE: empty-string finish_reason + double [DONE] (#4640)", () => {
  it("normalizes empty finish_reason to null and emits single [DONE]", async () => {
    const output = await collectStreamOutput(CODEBUDDY_CN_SSE);
    const events = parseSSEEvents(output);

    // Should have 4 content chunks + 1 terminal chunk + 1 DONE = 6 events
    const chunks = events.filter((e) => e.type === "CHUNK");
    const dones = events.filter((e) => e.type === "DONE");

    // Content chunks should have finish_reason: null (not "")
    for (const chunk of chunks.slice(0, 3)) {
      const fr = chunk.data.choices[0].finish_reason;
      expect(fr).toBeNull();
    }

    // Terminal chunk should have real finish_reason
    const terminalChunk = chunks.find((c) => c.data.choices[0].finish_reason === "stop");
    expect(terminalChunk).toBeDefined();
    expect(terminalChunk.data.choices[0].finish_reason).toBe("stop");

    // Exactly one [DONE]
    expect(dones).toHaveLength(1);
  });
});

describe("codebuddy-cn SSE: long turn where terminal chunk arrives late", () => {
  it("does not drop terminal chunk with real finish_reason", async () => {
    // Simulate long turn: many chunks with empty finish_reason, then terminal chunk arrives after delay
    // Include blank lines between SSE events (per SSE spec)
    const longTurnSSE = [
      ...Array(10).fill(0).flatMap((_, i) => [
        `data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"token${i}"},"finish_reason":""}]}`,
        '',
      ]),
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"length"}]}',
      '',
      'data: [DONE]',
      '',
      'data: [DONE]',
      '',
    ];

    const output = await collectStreamOutput(longTurnSSE);
    const events = parseSSEEvents(output);

    const chunks = events.filter((e) => e.type === "CHUNK");
    const dones = events.filter((e) => e.type === "DONE");

    // All mid-stream chunks should have finish_reason: null
    for (const chunk of chunks.slice(0, 10)) {
      expect(chunk.data.choices[0].finish_reason).toBeNull();
    }

    // Terminal chunk with "length" should be present
    const terminalChunk = chunks.find((c) => c.data.choices[0].finish_reason === "length");
    expect(terminalChunk).toBeDefined();

    // Exactly one [DONE]
    expect(dones).toHaveLength(1);
  });
});