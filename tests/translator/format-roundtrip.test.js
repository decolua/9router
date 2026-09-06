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
describe("roundtrip: Claude → openai-responses (Responses-only Muse Spark Free)", () => {
  const freeBody = {
    model: "muse-spark-1.2-contributor-free",
    max_tokens: 16000,
    system: "You are a weather bot.",
    messages: [
      { role: "user", content: "What is the weather in Hanoi?" },
      { role: "assistant", content: [{ type: "tool_use", id: "toolu_01test", name: "get_weather", input: { city: "Hanoi" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_01test", content: "12C sunny" }] },
      { role: "assistant", content: [{ type: "text", text: "It is 12C in Hanoi." }] },
    ],
    tools: [{ type: "custom", name: "get_weather", description: "Get current weather for a city", input_schema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } }],
  };
  const out = T(FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES, freeBody);

  it("maps max_tokens → max_output_tokens (never the Responses-invalid max_tokens)", () => {
    expect(out.max_tokens).toBeUndefined();
    // adjustMaxTokens (maxTokens.js) auto-raises to DEFAULT_MIN_TOKENS=32000 when tools are present
    expect(out.max_output_tokens).toBe(32000);
  });

  it("system → instructions, messages → input items, custom tool → function tool", () => {
    expect(out.instructions).toContain("You are a weather bot.");
    expect(out.input.map((i) => i.type)).toEqual(["message", "function_call", "function_call_output", "message"]);
    expect(out.input[0].role).toBe("user");
    expect(out.input[0].content[0].type).toBe("input_text");
    expect(out.input[0].content[0].text).toBe("What is the weather in Hanoi?");
    expect(out.input[1].name).toBe("get_weather");
    expect(out.input[1].arguments).toContain("Hanoi");
    expect(out.input[2].call_id).toBe("toolu_01test");
    expect(out.input[2].output).toBe("12C sunny");
    expect(out.input[3].role).toBe("assistant");
    expect(out.input[3].content[0].type).toBe("output_text");
    expect(out.tools).toHaveLength(1);
    expect(out.tools[0].type).toBe("function");
    expect(out.tools[0].name).toBe("get_weather");
  });
});
