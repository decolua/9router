import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {})
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { translateNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");
const { handleForcedSSEToJson } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");

const OPENAI_CHAT_COMPLETION = {
  id: "chatcmpl-test-123",
  object: "chat.completion",
  created: 1700000000,
  model: "claude-sonnet-4-6",
  choices: [
    {
      index: 0,
      message: {
        role: "assistant",
        content: "Hello from test!",
        tool_calls: [
          {
            id: "call_tool_1",
            type: "function",
            function: { name: "Read", arguments: JSON.stringify({ file_path: "/test.txt" }) }
          }
        ]
      },
      finish_reason: "tool_calls"
    }
  ],
  usage: {
    prompt_tokens: 15,
    completion_tokens: 25,
    total_tokens: 40
  }
};

const GEMINI_NONSTREAM_RESPONSE = {
  response: {
    responseId: "resp-gemini-123",
    modelVersion: "gemini-3.8-flash",
    createTime: "2026-09-04T00:00:00Z",
    candidates: [
      {
        content: {
          role: "model",
          parts: [
            { text: "Hello from Gemini non-stream!" }
          ]
        },
        finishReason: "STOP"
      }
    ],
    usageMetadata: {
      promptTokenCount: 10,
      candidatesTokenCount: 20,
      totalTokenCount: 30
    }
  }
};

describe("Claude non-streaming response translation", () => {
  it("translates OpenAI chat.completion to Claude message when sourceFormat is CLAUDE", () => {
    const out = translateNonStreamingResponse(
      OPENAI_CHAT_COMPLETION,
      FORMATS.OPENAI,
      FORMATS.CLAUDE
    );

    expect(out.type).toBe("message");
    expect(out.role).toBe("assistant");
    expect(out.id).toBe("test-123");
    expect(Array.isArray(out.content)).toBe(true);

    const textBlock = out.content.find(c => c.type === "text");
    expect(textBlock?.text).toBe("Hello from test!");

    const toolUseBlock = out.content.find(c => c.type === "tool_use");
    expect(toolUseBlock?.id).toBe("call_tool_1");
    expect(toolUseBlock?.name).toBe("Read");
    expect(toolUseBlock?.input).toEqual({ file_path: "/test.txt" });

    expect(out.stop_reason).toBe("tool_use");
    expect(out.usage).toEqual({
      input_tokens: 15,
      output_tokens: 25
    });
  });

  it("translates Gemini/Antigravity response to Claude message when sourceFormat is CLAUDE", () => {
    const out = translateNonStreamingResponse(
      GEMINI_NONSTREAM_RESPONSE,
      FORMATS.ANTIGRAVITY,
      FORMATS.CLAUDE
    );

    expect(out.type).toBe("message");
    expect(out.role).toBe("assistant");
    expect(Array.isArray(out.content)).toBe(true);
    expect(out.content[0]).toEqual({ type: "text", text: "Hello from Gemini non-stream!" });
    expect(out.stop_reason).toBe("end_turn");
    expect(out.usage).toEqual({
      input_tokens: 10,
      output_tokens: 20
    });
  });
});
