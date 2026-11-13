// Regression for #4992 — a streamed tool_call fragment that opens a new index
// without an `id` aborts strict OpenAI-compatible clients
// (@ai-sdk/openai-compatible: "Expected 'id' to be a string.").
//
// The gateway forwards openai→openai chunks as-is, so the missing id has to be
// filled in on the response path — the request-side ensureToolCallIds() never
// sees it.
import { describe, it, expect } from "vitest";

import { ensureStreamToolCallIds } from "../../open-sse/utils/streamHelpers.js";
import { createSSEStream } from "../../open-sse/utils/stream.js";
import { translateResponse, initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const chunk = (delta, extra = {}) => ({
  id: "chatcmpl-abc12345",
  object: "chat.completion.chunk",
  created: 1700000000,
  model: "m",
  choices: [{ index: 0, delta, finish_reason: null }],
  ...extra,
});

async function readAll(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

describe("ensureStreamToolCallIds", () => {
  it("mints an id for a fragment that opens a new index without one", () => {
    const seen = new Map();
    const c = chunk({ tool_calls: [{ index: 3, function: { name: "read", arguments: "{}" } }] });

    expect(ensureStreamToolCallIds(c, seen)).toBe(true);
    expect(typeof c.choices[0].delta.tool_calls[0].id).toBe("string");
    expect(c.choices[0].delta.tool_calls[0].id.length).toBeGreaterThan(0);
  });

  it("reuses the id already seen for the same index instead of minting a new one", () => {
    const seen = new Map();
    const first = chunk({ tool_calls: [{ index: 0, id: "call_abc", function: { name: "read" } }] });
    ensureStreamToolCallIds(first, seen);

    const later = chunk({ tool_calls: [{ index: 0, function: { arguments: "\"file\"" } }] });
    expect(ensureStreamToolCallIds(later, seen)).toBe(true);
    expect(later.choices[0].delta.tool_calls[0].id).toBe("call_abc");
  });

  it("keeps an id the provider supplied and records it for later fragments", () => {
    const seen = new Map();
    const c = chunk({ tool_calls: [{ index: 1, id: "call_from_upstream", function: { name: "read" } }] });

    expect(ensureStreamToolCallIds(c, seen)).toBe(false);
    expect(c.choices[0].delta.tool_calls[0].id).toBe("call_from_upstream");
    expect(seen.get(1)).toBe("call_from_upstream");
  });

  it("leaves chunks without tool_calls untouched", () => {
    const seen = new Map();
    const c = chunk({ content: "hello" });

    expect(ensureStreamToolCallIds(c, seen)).toBe(false);
    expect(c.choices[0].delta.tool_calls).toBeUndefined();
  });

  it("gives every tool call in one chunk its own id", () => {
    const seen = new Map();
    const c = chunk({
      tool_calls: [
        { index: 0, function: { name: "a" } },
        { index: 1, function: { name: "b" } },
      ],
    });

    ensureStreamToolCallIds(c, seen);
    const calls = c.choices[0].delta.tool_calls;
    expect(calls[0].id).toBeTruthy();
    expect(calls[1].id).toBeTruthy();
    expect(calls[0].id).not.toBe(calls[1].id);
  });
});

describe("openai→openai response translation", () => {
  it("fills the missing id before the chunk reaches the client", () => {
    const state = initState(FORMATS.OPENAI);
    const c = chunk({ tool_calls: [{ index: 2, function: { name: "read", arguments: "{}" } }] });

    const out = translateResponse(FORMATS.OPENAI, FORMATS.OPENAI, c, state);

    expect(out).toHaveLength(1);
    expect(typeof out[0].choices[0].delta.tool_calls[0].id).toBe("string");
  });

  it("keeps the id stable across the fragments of one tool call", () => {
    const state = initState(FORMATS.OPENAI);

    const first = translateResponse(FORMATS.OPENAI, FORMATS.OPENAI,
      chunk({ tool_calls: [{ index: 0, function: { name: "read" } }] }), state);
    const second = translateResponse(FORMATS.OPENAI, FORMATS.OPENAI,
      chunk({ tool_calls: [{ index: 0, function: { arguments: "\"a.txt\"" } }] }), state);

    expect(first[0].choices[0].delta.tool_calls[0].id)
      .toBe(second[0].choices[0].delta.tool_calls[0].id);
  });
});

describe("passthrough SSE stream", () => {
  it("emits an id for a tool call that arrives without one", async () => {
    const sse = [
      chunk({ role: "assistant" }),
      chunk({ tool_calls: [{ index: 0, function: { name: "read", arguments: "{}" } }] }),
      chunk({}, { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }),
    ].map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";

    const stream = createSSEStream({ mode: "passthrough", provider: "opencode-go" });
    const writer = stream.writable.getWriter();
    const readPromise = readAll(stream.readable);
    await writer.write(new TextEncoder().encode(sse));
    await writer.close();
    const out = await readPromise;

    const toolCallLines = out
      .split("\n")
      .filter((l) => l.startsWith("data: ") && l.includes("tool_calls"))
      .map((l) => JSON.parse(l.slice(6)));

    expect(toolCallLines.length).toBeGreaterThan(0);
    for (const parsed of toolCallLines) {
      const calls = parsed.choices[0].delta.tool_calls;
      if (!Array.isArray(calls)) continue;
      for (const tc of calls) {
        expect(typeof tc.id).toBe("string");
        expect(tc.id.length).toBeGreaterThan(0);
      }
    }
  });
});
