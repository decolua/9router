import { describe, expect, it } from "vitest";
import { translateNonStreamingResponse } from "open-sse/handlers/chatCore/nonStreamingHandler.js";
import { shapeCompletionForClient } from "open-sse/handlers/chatCore/completionToClient.js";

const completion = (over = {}) => ({
  id: "chatcmpl-abc123",
  object: "chat.completion",
  created: 1700000000,
  model: "glm-5",
  choices: [{
    index: 0,
    message: {
      role: "assistant",
      content: "olá",
      tool_calls: [{ id: "call_1", type: "function", function: { name: "Read", arguments: '{"file_path":"/a.js"}' } }],
    },
    finish_reason: "stop", // provider devolveu stop apesar do tool_call
  }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  ...over,
});

describe("non-streaming client shaping (stage 2)", () => {
  it("claude client on a kiro-format provider gets a Message, not chat.completion", () => {
    const out = translateNonStreamingResponse(completion(), "kiro", "claude");
    expect(out.type).toBe("message");
    expect(out.id).toBe("abc123");
    const toolUses = out.content.filter((b) => b.type === "tool_use");
    expect(toolUses).toHaveLength(1);
    expect(toolUses[0].input).toEqual({ file_path: "/a.js" });
    // fixup: tool_calls presentes ⇒ stop_reason tool_use mesmo com finish "stop"
    expect(out.stop_reason).toBe("tool_use");
    expect(out.usage).toEqual({ input_tokens: 10, output_tokens: 5 });
  });

  it("claude client on an openai-responses (codex) provider gets a Message", () => {
    const out = translateNonStreamingResponse(completion(), "openai-responses", "claude");
    expect(out.type).toBe("message");
  });

  it("responses client on a kiro-format provider gets a Responses body", () => {
    const out = translateNonStreamingResponse(completion(), "kiro", "openai-responses");
    expect(out.object).toBe("response");
    expect(out.output.some((i) => i.type === "function_call")).toBe(true);
  });

  it("gemini provider + claude client converts through to a Message", () => {
    const geminiBody = {
      candidates: [{ content: { role: "model", parts: [{ text: "oi" }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1, totalTokenCount: 4 },
    };
    const out = translateNonStreamingResponse(geminiBody, "gemini", "claude");
    expect(out.type).toBe("message");
    expect(out.content[0]).toEqual({ type: "text", text: "oi" });
  });

  it("openai client keeps the raw completion (no reshaping)", () => {
    const body = completion();
    expect(translateNonStreamingResponse(body, "kiro", "openai")).toBe(body);
    expect(shapeCompletionForClient(body, "openai")).toBe(body);
  });

  it("openai→claude and openai→responses parity with the old direct branches", () => {
    const claude = translateNonStreamingResponse(completion(), "openai", "claude");
    expect(claude.type).toBe("message");
    const responses = translateNonStreamingResponse(completion(), "openai", "openai-responses");
    expect(responses.object).toBe("response");
  });

  it("non-completion bodies pass through unharmed", () => {
    const weird = { message: "not a completion" };
    expect(shapeCompletionForClient(weird, "claude")).toBe(weird);
  });
});
