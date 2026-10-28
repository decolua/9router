/**
 * Issue #11: Responses-API stateless continuations send only function_call_output
 * items (the originating function_call lives in the prior server-side response).
 * The naive translation produced orphan role:"tool" messages, which Chat
 * Completions rejects with 400. The translator must synthesize the missing
 * assistant tool_calls pair.
 */
import { describe, it, expect } from "vitest";
import { openaiResponsesToOpenAIRequest } from "../../open-sse/translator/request/openai-responses.js";

function toolMessagePairsValid(messages) {
  const known = new Set();
  for (const m of messages) {
    if (m.role === "assistant" && Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) if (tc?.id) known.add(tc.id);
    } else if (m.role === "tool") {
      if (!m.tool_call_id || !known.has(m.tool_call_id)) return false;
    }
  }
  return true;
}

describe("responses→openai orphan tool messages (#11)", () => {
  it("synthesizes an assistant tool_calls pair for a lone function_call_output", () => {
    const body = {
      model: "m",
      previous_response_id: "resp_x",
      input: [{ type: "function_call_output", call_id: "call_a", output: "{\"ok\":true}" }],
    };

    const out = openaiResponsesToOpenAIRequest("m", body, true, null);
    const tool = out.messages.find((m) => m.role === "tool");
    expect(tool?.tool_call_id).toBe("call_a");
    expect(toolMessagePairsValid(out.messages)).toBe(true);

    const idx = out.messages.findIndex((m) => m.role === "tool");
    const before = out.messages[idx - 1];
    expect(before.role).toBe("assistant");
    expect(before.tool_calls?.[0]?.id).toBe("call_a");
  });

  it("leaves an already-paired function_call + output unchanged", () => {
    const body = {
      model: "m",
      input: [
        { type: "function_call", call_id: "call_b", name: "my_tool", arguments: "{}" },
        { type: "function_call_output", call_id: "call_b", output: "done" },
      ],
    };

    const out = openaiResponsesToOpenAIRequest("m", body, true, null);
    const assistants = out.messages.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(1);
    expect(assistants[0].tool_calls).toHaveLength(1);
    expect(assistants[0].tool_calls[0].function.name).toBe("my_tool");
    expect(toolMessagePairsValid(out.messages)).toBe(true);
  });

  it("pairs multiple orphan outputs", () => {
    const body = {
      model: "m",
      input: [
        { type: "function_call_output", call_id: "call_c1", output: "a" },
        { type: "function_call_output", call_id: "call_c2", output: "b" },
      ],
    };

    const out = openaiResponsesToOpenAIRequest("m", body, true, null);
    expect(out.messages.filter((m) => m.role === "tool")).toHaveLength(2);
    expect(toolMessagePairsValid(out.messages)).toBe(true);
  });

  it("does not add assistant messages when there are no tool messages", () => {
    const body = { model: "m", input: "say hi" };
    const out = openaiResponsesToOpenAIRequest("m", body, true, null);
    expect(out.messages.some((m) => m.role === "assistant")).toBe(false);
  });
});
