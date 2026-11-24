import { describe, expect, it, vi } from "vitest";

import { createDeltaCoalescer } from "../../open-sse/utils/sseDeltaCoalesce.js";

// Activate coalescing for the merge tests; individual tests below clear it again.
process.env.SSE_COALESCE_MS = "400";

// #4558: Claude Code's VS Code extension renders one postMessage per SSE event
// and falls behind on providers that emit one content_block_delta per token.
// The coalescer merges consecutive same-index, same-type deltas — losslessly,
// by concatenation — and is OFF by default (gated by SSE_COALESCE_* env vars at
// the call site).

const td = (index, type, data) => ({ type: "content_block_delta", index, delta: { type, ...data } });
const boundary = (type, extra = {}) => ({ type, ...extra });

function collect() {
  const out = [];
  const c = createDeltaCoalescer((evts) => out.push(...evts));
  return { c, out };
}

describe("createDeltaCoalescer", () => {
  it("merges consecutive same-index, same-type thinking deltas", async () => {
    const { c, out } = collect();
    c.feed(td(0, "thinking_delta", { thinking: "a" }));
    c.feed(td(0, "thinking_delta", { thinking: "b" }));
    c.feed(td(0, "thinking_delta", { thinking: "c" }));
    c.flush();
    expect(out).toHaveLength(1);
    expect(out[0].delta).toEqual({ type: "thinking_delta", thinking: "abc" });
  });

  it("merges a text burst the same way", async () => {
    const { c, out } = collect();
    c.feed(td(1, "text_delta", { text: "Hello" }));
    c.feed(td(1, "text_delta", { text: ", " }));
    c.feed(td(1, "text_delta", { text: "world" }));
    c.flush();
    expect(out).toHaveLength(1);
    expect(out[0].delta.text).toBe("Hello, world");
  });

  it("does NOT merge across a different index", async () => {
    const { c, out } = collect();
    c.feed(td(0, "thinking_delta", { thinking: "x" }));
    c.feed(td(1, "thinking_delta", { thinking: "y" }));
    c.flush();
    expect(out).toHaveLength(2);
  });

  it("does NOT merge across a different delta type", async () => {
    const { c, out } = collect();
    c.feed(td(0, "thinking_delta", { thinking: "t" }));
    c.feed(td(0, "text_delta", { text: "z" }));
    c.flush();
    expect(out).toHaveLength(2);
    expect(out[0].delta.type).toBe("thinking_delta");
    expect(out[1].delta.type).toBe("text_delta");
  });

  it("flushes pending deltas when a boundary event arrives, preserving order", () => {
    const { c, out } = collect();
    c.feed(td(0, "thinking_delta", { thinking: "ab" }));
    c.feed(boundary("content_block_stop", { index: 0 }));
    expect(out).toHaveLength(2);
    expect(out[0].type).toBe("content_block_delta");
    expect(out[0].delta.thinking).toBe("ab");
    expect(out[1].type).toBe("content_block_stop");
  });

  it("passes boundary events through unchanged", () => {
    const { c, out } = collect();
    c.feed(boundary("message_start", { message: { id: "m" } }));
    c.feed(boundary("ping"));
    c.feed(boundary("message_stop"));
    expect(out.map((e) => e.type)).toEqual(["message_start", "ping", "message_stop"]);
  });

  it("handles input_json_delta by concatenating partial_json", () => {
    const { c, out } = collect();
    c.feed(td(2, "input_json_delta", { partial_json: '{"co' }));
    c.feed(td(2, "input_json_delta", { partial_json: 'mmand":' }));
    c.feed(td(2, "input_json_delta", { partial_json: '"ls"}' }));
    c.flush();
    expect(out).toHaveLength(1);
    expect(out[0].delta.partial_json).toBe('{"command":"ls"}');
  });

  it("is OFF by default (no env var set)", () => {
    const env = { ...process.env };
    try {
      delete process.env.SSE_COALESCE_MS;
      delete process.env.SSE_COALESCE_THINKING_MS;
      delete process.env.SSE_COALESCE_TEXT_MS;
      delete process.env.SSE_COALESCE_INPUT_JSON_MS;
      const { c } = collect();
      expect(c.enabled()).toBe(false);

      process.env.SSE_COALESCE_MS = "400";
      const { c: c1 } = collect();
      expect(c1.enabled()).toBe(true);

      delete process.env.SSE_COALESCE_MS;
      process.env.SSE_COALESCE_THINKING_MS = "0";
      const { c: c0 } = collect();
      expect(c0.enabled()).toBe(false);
    } finally {
      process.env = env;
    }
  });

  it("does not merge across content_block_stop for the same index", () => {
    const { c, out } = collect();
    c.feed(td(0, "text_delta", { text: "first" }));
    c.feed(boundary("content_block_stop", { index: 0 }));
    c.feed(td(0, "text_delta", { text: "second" }));
    c.flush();
    const texts = out.filter((e) => e.type === "content_block_delta").map((e) => e.delta.text);
    expect(texts).toEqual(["first", "second"]);
  });

  it("a timer flush emits the pending group on its own schedule", async () => {
    return new Promise((resolve) => {
      const out = [];
      const c = createDeltaCoalescer((evts) => out.push(...evts));
      process.env.SSE_COALESCE_MS = "20";
      try {
        c.feed(td(0, "thinking_delta", { thinking: "batch" }));
        expect(out).toHaveLength(0);           // buffered, not yet flushed
        setTimeout(() => {
          expect(out).toHaveLength(1);
          expect(out[0].delta.thinking).toBe("batch");
          resolve();
        }, 60);
      } finally {
        delete process.env.SSE_COALESCE_MS;
      }
    });
  });

  it("preserves a delta's other fields when merging", () => {
    const env = process.env.SSE_COALESCE_MS;
    process.env.SSE_COALESCE_MS = "400";
    try {
      const { c, out } = collect();
      c.feed({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "a", extra: 1 } });
      c.feed({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "b" } });
      c.flush();
      expect(out).toHaveLength(1);
      expect(out[0].delta.text).toBe("ab");
      expect(out[0].delta.extra).toBe(1);
    } finally {
      if (env === undefined) delete process.env.SSE_COALESCE_MS;
      else process.env.SSE_COALESCE_MS = env;
    }
  });
});
