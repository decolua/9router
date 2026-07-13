/**
 * Unit tests for open-sse/translator/request/gemini-to-openai.js —
 * functionResponse co-located with other parts in the same Gemini content.
 *
 * convertGeminiContent() early-returns on the first `functionResponse` part
 * it finds in a content's `parts` array, dropping any `functionCall` or
 * `text` parts that were co-located in the same content. Gemini clients can
 * send `functionResponse` alongside `functionCall` (e.g. multi-tool turns)
 * or alongside `text` (a user follow-up next to a tool result).
 *
 * Exercised through translateRequest(), the same registry path the router uses.
 */

import { describe, it, expect } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("gemini -> openai request translation — functionResponse co-located with other parts", () => {
  it("preserves a functionCall co-located with a functionResponse in the same content", () => {
    const body = {
      contents: [
        {
          role: "model",
          parts: [{ functionCall: { id: "call_b", name: "tool_b", args: {} } }]
        },
        {
          role: "user",
          parts: [
            { functionCall: { id: "call_a", name: "tool_a", args: {} } },
            { functionResponse: { id: "call_b", name: "tool_b", response: { result: "b done" } } }
          ]
        }
      ]
    };

    const result = translateRequest(FORMATS.GEMINI, FORMATS.OPENAI, "gemini-pro", body, false);

    const toolMsg = result.messages.find(m => m.role === "tool");
    const assistantMsg = result.messages.find(m =>
      m.role === "assistant" && m.tool_calls?.some(call => call.function.name === "tool_a")
    );

    expect(toolMsg).toBeDefined();
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg.tool_calls[0].function.name).toBe("tool_a");
  });

  it("preserves multiple functionResponses in the same content", () => {
    const body = {
      contents: [
        {
          role: "model",
          parts: [
            { functionCall: { id: "call_a", name: "tool_a", args: {} } },
            { functionCall: { id: "call_b", name: "tool_b", args: {} } }
          ]
        },
        {
          role: "user",
          parts: [
            { functionResponse: { id: "call_a", name: "tool_a", response: { result: "a done" } } },
            { functionResponse: { id: "call_b", name: "tool_b", response: { result: "b done" } } }
          ]
        }
      ]
    };

    const result = translateRequest(FORMATS.GEMINI, FORMATS.OPENAI, "gemini-pro", body, false);
    const toolMsgs = result.messages.filter(m => m.role === "tool");

    expect(toolMsgs).toHaveLength(2);
    expect(toolMsgs.map(m => m.tool_call_id).sort()).toEqual(["call_a", "call_b"]);
  });

  it("preserves text co-located with a functionResponse, keeping the original turn role", () => {
    const body = {
      contents: [
        {
          role: "model",
          parts: [{ functionCall: { id: "call_a", name: "tool_a", args: {} } }]
        },
        {
          role: "user",
          parts: [
            { functionResponse: { id: "call_a", name: "tool_a", response: { result: "a done" } } },
            { text: "also please summarize" }
          ]
        }
      ]
    };

    const result = translateRequest(FORMATS.GEMINI, FORMATS.OPENAI, "gemini-pro", body, false);

    const toolMsg = result.messages.find(m => m.role === "tool");
    const userMsg = result.messages.find(m => m.role === "user" && m.content === "also please summarize");
    const asstWithText = result.messages.find(m => m.role === "assistant" && m.content === "also please summarize");

    expect(toolMsg).toBeDefined();
    expect(userMsg).toBeDefined();
    expect(asstWithText).toBeUndefined();
  });

  it("still works for a functionResponse alone (no regression)", () => {
    const body = {
      contents: [
        {
          role: "model",
          parts: [{ functionCall: { id: "call_a", name: "tool_a", args: {} } }]
        },
        { role: "user", parts: [{ functionResponse: { id: "call_a", name: "tool_a", response: { result: "a done" } } }] }
      ]
    };

    const result = translateRequest(FORMATS.GEMINI, FORMATS.OPENAI, "gemini-pro", body, false);

    const toolMsgs = result.messages.filter(m => m.role === "tool");
    expect(toolMsgs).toHaveLength(1);
    expect(toolMsgs[0].tool_call_id).toBe("call_a");
  });
});
