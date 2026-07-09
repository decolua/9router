// Tier 2 — Format-pair: for each CLI source format, translate to openai and verify
// core parts (text, tool, system) survive. Exposes bridge data loss.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const T = (src, tgt, body, provider = null) =>
  translateRequest(src, tgt, "m", body, true, null, provider);

describe("roundtrip: Claude source preserves core fields → OpenAI", () => {
  const body = {
    system: "sys",
    max_tokens: 100,
    messages: [
      { role: "user", content: "question" },
      { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "search", input: { q: "x" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "result" }] },
    ],
  };
  const out = T(FORMATS.CLAUDE, FORMATS.OPENAI, body);

  it("system → system role", () => {
    expect(out.messages.some((m) => m.role === "system" && m.content === "sys")).toBe(true);
  });
  it("tool_use → assistant.tool_calls with matching id", () => {
    const asst = out.messages.find((m) => m.tool_calls);
    expect(asst?.tool_calls?.[0]?.id).toBe("call_1");
  });
  it("tool_result → tool message with matching id", () => {
    const tool = out.messages.find((m) => m.role === "tool");
    expect(tool?.tool_call_id).toBe("call_1");
    expect(tool?.content).toContain("result");
  });
  it("tool arguments are valid JSON string", () => {
    const asst = out.messages.find((m) => m.tool_calls);
    expect(() => JSON.parse(asst.tool_calls[0].function.arguments)).not.toThrow();
  });
});

describe("roundtrip: OpenAI tools → Claude → keeps tool name", () => {
  const out = T(FORMATS.OPENAI, FORMATS.CLAUDE, {
    messages: [{ role: "user", content: "hi" }],
    tools: [{ type: "function", function: { name: "my_tool", description: "d", parameters: { type: "object", properties: {} } } }],
  }, "anthropic-compatible-x");

  it("tool name survives openai→claude", () => {
    expect(JSON.stringify(out)).toContain("my_tool");
  });
});

describe("roundtrip: parallel tool calls keep distinct ids", () => {
  // Claude assistant with 2 parallel tool_use → openai must keep 2 distinct ids
  const out = T(FORMATS.CLAUDE, FORMATS.OPENAI, {
    messages: [
      { role: "assistant", content: [
        { type: "tool_use", id: "call_a", name: "f1", input: {} },
        { type: "tool_use", id: "call_b", name: "f2", input: {} },
      ] },
      { role: "user", content: [
        { type: "tool_result", tool_use_id: "call_a", content: "ra" },
        { type: "tool_result", tool_use_id: "call_b", content: "rb" },
      ] },
    ],
  });

  it("two tool_calls, two distinct ids", () => {
    const asst = out.messages.find((m) => m.tool_calls);
    const ids = asst.tool_calls.map((tc) => tc.id);
    expect(new Set(ids).size).toBe(2);
  });
  it("each tool_call has a matching tool result", () => {
    const toolMsgs = out.messages.filter((m) => m.role === "tool");
    expect(toolMsgs.length).toBe(2);
  });
});
