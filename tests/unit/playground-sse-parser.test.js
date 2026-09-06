import { describe, expect, it } from "vitest";

import { createSseParser } from "../../src/app/(dashboard)/dashboard/playground/lib/sseParser.js";

const encoder = new TextEncoder();

function parseChunks(chunks) {
  const parser = createSseParser();
  const events = chunks.flatMap((chunk) => parser.push(encoder.encode(chunk)));
  return { events, terminal: parser.close() };
}

describe("Playground SSE parser", () => {
  it("reconstructs fragmented UTF-8 deltas once and preserves final usage", () => {
    // Given: a response split across JSON and UTF-8 boundaries
    const parser = createSseParser();

    // When: chunks contain two deltas, usage, and the terminal sentinel
    const events = [
      ...parser.push(encoder.encode('data: {"cho')),
      ...parser.push(encoder.encode('ices":[{"delta":{"content":"Hello, ')),
      ...parser.push(encoder.encode('世')),
      ...parser.push(encoder.encode('界"}}]}\r\n\r\ndata:{"choices":[{"delta":{"content":"!"}}]}\r\n\r\n')),
      ...parser.push(encoder.encode('data: {"usage":{"prompt_tokens":3,"completion_tokens":4,"total_tokens":7}}\r\n\r\ndata: [DONE]\r\n\r\n')),
    ];

    // Then: text is neither lost nor duplicated, and usage stays authoritative
    expect(events).toEqual([
      { type: "delta", text: "Hello, 世界" },
      { type: "delta", text: "!" },
      { type: "usage", usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 } },
      { type: "done" },
    ]);
    expect(parser.close()).toBeNull();
  });

  it("parses multiple LF frames with optional data spacing", () => {
    // Given: distinct frames delivered in one chunk
    // When: both optional `data:` spacing forms are parsed
    const { events, terminal } = parseChunks([
      'data:{"choices":[{"delta":{"content":"one"}}]}\n\ndata: {"choices":[{"delta":{"content":"two"}}]}\n\ndata: [DONE]\n\n',
    ]);

    // Then: both frames are emitted in order
    expect(events).toEqual([
      { type: "delta", text: "one" },
      { type: "delta", text: "two" },
      { type: "done" },
    ]);
    expect(terminal).toBeNull();
  });

  it("recovers from malformed JSON and emits normalized error events", () => {
    // Given: a bad frame before a valid frame and a structured error
    // When: the stream continues after the malformed JSON
    const { events } = parseChunks([
      'data: {bad json}\n\ndata: {"choices":[{"delta":{"content":"recovered"}}]}\n\nevent: error\ndata: {"error":{"message":"upstream failed"}}\n\n',
    ]);

    // Then: recovery retains the valid delta and reports the error
    expect(events).toEqual([
      { type: "malformed", raw: "{bad json}" },
      { type: "delta", text: "recovered" },
      { type: "error", message: "upstream failed" },
    ]);
  });

  it("reports incomplete only when transport closes without terminal evidence", () => {
    // Given: a stream with a partial assistant response but no terminal event
    const parser = createSseParser();
    parser.push(encoder.encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'));

    // When: the reader closes
    const terminal = parser.close();

    // Then: reader-close is not mislabeled as success
    expect(terminal).toEqual({ type: "incomplete" });
  });
});
