/**
 * Unit tests for open-sse/translator/response/commandcode-to-openai.js
 *
 * Verified live against upstream stream (curl, 2026-05-07):
 *  - tool-input-start: { id, toolName }   (id, NOT toolCallId)
 *  - tool-input-delta: { id, delta }      (id, NOT toolCallId; delta, NOT inputTextDelta)
 *  - tool-input-end:   { id }
 *  - tool-call (final): { toolCallId, toolName, input }
 */

import { describe, it, expect } from "vitest";
import { commandCodeToOpenAIResponse } from "../../open-sse/translator/response/commandcode-to-openai.js";

function feed(events) {
  const state = {};
  const all = [];
  for (const e of events) {
    const out = commandCodeToOpenAIResponse(JSON.stringify(e), state);
    if (out) for (const c of out) all.push(c);
  }
  return { state, chunks: all };
}

describe("commandcode-to-openai — text-delta", () => {
  it("emits assistant role on first delta then content-only", () => {
    const { chunks } = feed([
      { type: "text-delta", text: "Hello" },
      { type: "text-delta", text: " world" },
    ]);
    expect(chunks[0].choices[0].delta.role).toBe("assistant");
    expect(chunks[0].choices[0].delta.content).toBe("Hello");
    expect(chunks[1].choices[0].delta.role).toBeUndefined();
    expect(chunks[1].choices[0].delta.content).toBe(" world");
  });
});

describe("commandcode-to-openai — reasoning-delta", () => {
  it("maps reasoning-delta to reasoning_content delta", () => {
    const { chunks } = feed([
      { type: "reasoning-delta", text: "thinking..." },
    ]);
    expect(chunks[0].choices[0].delta.reasoning_content).toBe("thinking...");
  });
});

describe("commandcode-to-openai — tool-input-* with id field (live schema)", () => {
  it("does not emit provisional tool input", () => {
    const { chunks } = feed([
      { type: "tool-input-start", id: "call_X", toolName: "Bash" },
      { type: "tool-input-delta", id: "call_X", delta: "{\"cmd" },
      { type: "tool-input-delta", id: "call_X", delta: "\":\"ls\"}" },
    ]);
    expect(chunks).toHaveLength(0);
  });

  it("ignores tool-input-delta when id is unknown (no prior start)", () => {
    const { chunks } = feed([
      { type: "tool-input-delta", id: "unknown", delta: "x" },
    ]);
    expect(chunks.length).toBe(0);
  });
});

describe("commandcode-to-openai — final tool-call event", () => {
  it("uses the final authoritative input instead of provisional input", () => {
    const { chunks } = feed([
      { type: "tool-input-start", id: "call_Y", toolName: "Write" },
      { type: "tool-input-delta", id: "call_Y", delta: "{\"file\":\"draft\"}" },
      { type: "tool-call", toolCallId: "call_Y", toolName: "Write", input: { file: "final" } },
      { type: "finish", finishReason: "tool-calls" },
    ]);
    expect(chunks.length).toBe(2);
    const tc = chunks[0].choices[0].delta.tool_calls[0];
    expect(tc.function.arguments).toBe(JSON.stringify({ file: "final" }));
    expect(chunks[1].choices[0].finish_reason).toBe("tool_calls");
  });

  it("emits a consolidated tool call at finish", () => {
    const { chunks } = feed([
      { type: "tool-call", toolCallId: "call_Z", toolName: "Read", input: { path: "/x" } },
      { type: "finish", finishReason: "tool-calls" },
    ]);
    expect(chunks.length).toBe(2);
    const tc = chunks[0].choices[0].delta.tool_calls[0];
    expect(tc.id).toBe("call_Z");
    expect(tc.function.name).toBe("Read");
    expect(tc.function.arguments).toBe(JSON.stringify({ path: "/x" }));
  });
});

describe("commandcode-to-openai — finish", () => {
  it("emits a final chunk with finish_reason=tool_calls when finishReason is tool-calls", () => {
    const { chunks } = feed([
      { type: "tool-input-start", id: "call_F", toolName: "Bash" },
      { type: "tool-input-delta", id: "call_F", delta: "{}" },
      { type: "tool-call", toolCallId: "call_F", toolName: "Bash", input: {} },
      { type: "finish-step", finishReason: "tool-calls" },
      { type: "finish" },
    ]);
    const last = chunks[chunks.length - 1];
    expect(last.choices[0].finish_reason).toBe("tool_calls");
  });

  it("includes usage on the final chunk when totalUsage provided", () => {
    const { chunks } = feed([
      { type: "text-delta", text: "hi" },
      { type: "finish-step", finishReason: "stop", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
      { type: "finish", totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
    ]);
    const last = chunks[chunks.length - 1];
    expect(last.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
  });
});

describe("commandcode-to-openai — error event", () => {
  it("throws a readable transport error", () => {
    expect(() => feed([
      { type: "error", error: { type: "server_error", message: "Boom" } },
    ])).toThrow(/Boom/);
  });
});
