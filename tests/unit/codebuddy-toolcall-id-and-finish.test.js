// Regression: Claude Code <- 9Router <- CodeBuddy request/response tool-state.
//
// 1. A Claude `tool_use` block with a MISSING id must get one synthesized, or
//    the next turn's tool_result orphans (Anthropic requires every tool_use to
//    carry an id).
// 2. The forced-SSE->JSON collector must keep distinct parallel tool calls
//    separate when the upstream omits the optional `index`, and must normalize
//    a non-tool finish_reason to "tool_calls" when calls are present.
import { describe, expect, it } from "vitest";
import { ensureToolCallIds } from "../../open-sse/translator/concerns/toolCall.js";
import { parseSSEToOpenAIResponse } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";

describe("ensureToolCallIds synthesizes missing tool_use ids", () => {
  it("assigns an id to a tool_use block that has none", () => {
    const body = {
      messages: [
        { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: { command: "ls" } }] },
      ],
    };
    const out = ensureToolCallIds(body);
    const block = out.messages[0].content[0];
    expect(block.type).toBe("tool_use");
    expect(typeof block.id).toBe("string");
    expect(block.id.length).toBeGreaterThan(0);
  });

  it("assigns an id to a tool_result with no tool_use_id", () => {
    const body = {
      messages: [
        { role: "user", content: [{ type: "tool_result", content: "ok" }] },
      ],
    };
    const out = ensureToolCallIds(body);
    const block = out.messages[0].content[0];
    expect(typeof block.tool_use_id).toBe("string");
    expect(block.tool_use_id.length).toBeGreaterThan(0);
  });
});

// Minimal OpenAI streaming chunk helpers + SSE assembly.
const tc = (o) => ({ id: "chat", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta: { tool_calls: [o] }, finish_reason: null }] });
const fin = (reason) => ({ id: "chat", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta: {}, finish_reason: reason }] });
const sse = (chunks) => chunks.map((c) => `data: ${JSON.stringify(c)}\n`).join("") + "data: [DONE]\n";

describe("parseSSEToOpenAIResponse parallel tool calls without index", () => {
  it("keeps two distinct calls separate when upstream omits index", () => {
    const raw = sse([
      tc({ id: "call_a", type: "function", function: { name: "Read" } }),
      tc({ id: "call_b", type: "function", function: { name: "Bash" } }),
      tc({ id: "call_a", function: { arguments: '{"file_path":"/a"}' } }),
      tc({ id: "call_b", function: { arguments: '{"command":"ls"}' } }),
      fin("tool_calls"),
    ]);
    const out = parseSSEToOpenAIResponse(raw, "m");
    const calls = out.choices[0].message.tool_calls;
    expect(calls).toHaveLength(2);
    expect(new Set(calls.map((c) => c.id))).toEqual(new Set(["call_a", "call_b"]));
    const args = calls.map((c) => JSON.parse(c.function.arguments));
    expect(args).toContainEqual({ file_path: "/a" });
    expect(args).toContainEqual({ command: "ls" });
  });

  it("normalizes a non-tool finish_reason to tool_calls when calls are present", () => {
    const raw = sse([
      tc({ index: 0, id: "call_x", type: "function", function: { name: "Bash", arguments: "{}" } }),
      fin("stop"),
    ]);
    const out = parseSSEToOpenAIResponse(raw, "m");
    expect(out.choices[0].finish_reason).toBe("tool_calls");
  });
});
