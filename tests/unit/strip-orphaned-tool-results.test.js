import { describe, expect, it } from "vitest";
import { stripOrphanedToolResults } from "../../open-sse/translator/concerns/toolCall.js";

// ── OpenAI Chat Completions ──────────────────────────────────────────────────

describe("stripOrphanedToolResults – OpenAI Chat Completions (messages[])", () => {
  it("removes role:tool message whose tool_call_id has no matching assistant turn", () => {
    const body = {
      messages: [
        { role: "tool", tool_call_id: "call_missing", content: "stale result" },
        { role: "user", content: "continue" },
      ],
    };
    const count = stripOrphanedToolResults(body);
    expect(count).toBe(1);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe("user");
  });

  it("keeps role:tool message when a matching assistant tool_calls entry exists", () => {
    const body = {
      messages: [
        {
          role: "assistant",
          tool_calls: [{ id: "call_abc", type: "function", function: { name: "search", arguments: "{}" } }],
        },
        { role: "tool", tool_call_id: "call_abc", content: "result" },
      ],
    };
    const count = stripOrphanedToolResults(body);
    expect(count).toBe(0);
    expect(body.messages).toHaveLength(2);
  });

  it("handles mixed: keeps paired result, removes orphan", () => {
    const body = {
      messages: [
        {
          role: "assistant",
          tool_calls: [{ id: "call_live", type: "function", function: { name: "fn", arguments: "{}" } }],
        },
        { role: "tool", tool_call_id: "call_live", content: "ok" },
        { role: "tool", tool_call_id: "call_gone", content: "stale" },
        { role: "user", content: "next" },
      ],
    };
    const count = stripOrphanedToolResults(body);
    expect(count).toBe(1);
    expect(body.messages.filter(m => m.role === "tool")).toHaveLength(1);
    expect(body.messages.find(m => m.tool_call_id === "call_gone")).toBeUndefined();
  });

  it("returns 0 and leaves body untouched when no tool messages present", () => {
    const body = {
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
      ],
    };
    const count = stripOrphanedToolResults(body);
    expect(count).toBe(0);
    expect(body.messages).toHaveLength(2);
  });
});

// ── Anthropic Messages ───────────────────────────────────────────────────────

describe("stripOrphanedToolResults – Anthropic (tool_result content blocks)", () => {
  it("removes orphaned tool_result block from user message content", () => {
    const body = {
      messages: [
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "toolu_gone", content: "stale" },
            { type: "text", text: "continue" },
          ],
        },
      ],
    };
    const count = stripOrphanedToolResults(body);
    expect(count).toBe(1);
    expect(body.messages[0].content).toHaveLength(1);
    expect(body.messages[0].content[0].type).toBe("text");
  });

  it("keeps tool_result block when a matching tool_use block exists", () => {
    const body = {
      messages: [
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "toolu_abc", name: "search", input: {} }],
        },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "toolu_abc", content: "found" }],
        },
      ],
    };
    const count = stripOrphanedToolResults(body);
    expect(count).toBe(0);
    expect(body.messages[1].content).toHaveLength(1);
  });
});

// ── OpenAI Responses API ─────────────────────────────────────────────────────

describe("stripOrphanedToolResults – OpenAI Responses API (input[])", () => {
  it("removes function_call_output whose call_id has no matching function_call", () => {
    const body = {
      input: [
        { type: "function_call_output", call_id: "call_missing", output: "stale result" },
        { type: "message", role: "user", content: [{ type: "input_text", text: "continue" }] },
      ],
    };
    const count = stripOrphanedToolResults(body);
    expect(count).toBe(1);
    expect(body.input).toHaveLength(1);
    expect(body.input[0].type).toBe("message");
  });

  it("keeps function_call_output when matching function_call exists", () => {
    const body = {
      input: [
        { type: "function_call", call_id: "call_live", name: "search", arguments: "{}" },
        { type: "function_call_output", call_id: "call_live", output: "result" },
      ],
    };
    const count = stripOrphanedToolResults(body);
    expect(count).toBe(0);
    expect(body.input).toHaveLength(2);
  });

  it("removes only orphaned outputs, keeps paired ones", () => {
    const body = {
      input: [
        { type: "function_call", call_id: "call_a", name: "fn", arguments: "{}" },
        { type: "function_call_output", call_id: "call_a", output: "ok" },
        { type: "function_call_output", call_id: "call_b_gone", output: "stale" },
      ],
    };
    const count = stripOrphanedToolResults(body);
    expect(count).toBe(1);
    expect(body.input).toHaveLength(2);
  });
});

// ── Gemini / Antigravity ─────────────────────────────────────────────────────

describe("stripOrphanedToolResults – Gemini (contents[].parts[])", () => {
  it("removes orphaned functionResponse part", () => {
    const body = {
      contents: [
        {
          role: "user",
          parts: [
            { functionResponse: { id: "fn_gone", name: "search", response: { output: "stale" } } },
            { text: "continue" },
          ],
        },
      ],
    };
    const count = stripOrphanedToolResults(body);
    expect(count).toBe(1);
    expect(body.contents[0].parts).toHaveLength(1);
    expect(body.contents[0].parts[0].text).toBe("continue");
  });

  it("keeps functionResponse when matching functionCall exists", () => {
    const body = {
      contents: [
        { role: "model", parts: [{ functionCall: { id: "fn_live", name: "search", args: {} } }] },
        { role: "user", parts: [{ functionResponse: { id: "fn_live", name: "search", response: { output: "ok" } } }] },
      ],
    };
    const count = stripOrphanedToolResults(body);
    expect(count).toBe(0);
    expect(body.contents[1].parts).toHaveLength(1);
  });

  it("falls back to name-based pairing when id is absent", () => {
    const body = {
      contents: [
        { role: "model", parts: [{ functionCall: { name: "search", args: {} } }] },
        {
          role: "user",
          parts: [
            { functionResponse: { name: "search", response: { output: "ok" } } },
            { functionResponse: { name: "gone_fn", response: { output: "stale" } } },
          ],
        },
      ],
    };
    const count = stripOrphanedToolResults(body);
    expect(count).toBe(1);
    expect(body.contents[1].parts).toHaveLength(1);
    expect(body.contents[1].parts[0].functionResponse.name).toBe("search");
  });
});

// ── Edge cases ───────────────────────────────────────────────────────────────

describe("stripOrphanedToolResults – edge cases", () => {
  it("returns 0 for empty body", () => {
    expect(stripOrphanedToolResults({})).toBe(0);
  });

  it("returns 0 when messages is not an array", () => {
    expect(stripOrphanedToolResults({ messages: null })).toBe(0);
  });

  it("does not remove role:tool message when tool_call_id is absent (pass-through)", () => {
    const body = {
      messages: [
        { role: "tool", content: "no id" },
      ],
    };
    const count = stripOrphanedToolResults(body);
    expect(count).toBe(0);
    expect(body.messages).toHaveLength(1);
  });
});
