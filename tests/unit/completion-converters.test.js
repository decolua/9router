import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {})
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { translateNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");
const {
  openAICompletionToClaudeMessage,
  openAICompletionToResponses,
} = await import("../../open-sse/handlers/chatCore/completionConverters.js");

const CHAT_BODY = {
  id: "chatcmpl-abc123",
  object: "chat.completion",
  created: 1700000000,
  model: "gpt-x",
  choices: [{
    index: 0,
    message: {
      role: "assistant",
      content: "hello",
      reasoning_content: "let me think",
      tool_calls: [{ id: "call_1", type: "function", function: { name: "shell", arguments: '{"cmd":"ls"}' } }]
    },
    finish_reason: "tool_calls"
  }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
};

describe("completionConverters refactor guard (Chat -> Claude non-stream)", () => {
  it("translates text + thinking + tool_use via the shared converter", () => {
    // targetFormat=provider format (OPENAI), sourceFormat=client format (CLAUDE)
    const out = translateNonStreamingResponse(CHAT_BODY, FORMATS.OPENAI, FORMATS.CLAUDE);
    expect(out.type).toBe("message");
    expect(out).not.toHaveProperty("choices");
    const kinds = (out.content || []).map((b) => b.type);
    expect(kinds).toEqual(["thinking", "text", "tool_use"]);
    expect(out.content[0]).toMatchObject({ type: "thinking", thinking: "let me think" });
    expect(out.content[1]).toMatchObject({ type: "text", text: "hello" });
    expect(out.content[2]).toMatchObject({ id: "call_1", name: "shell", input: { cmd: "ls" } });
    expect(out.stop_reason).toBe("tool_use");
    expect(out.usage).toMatchObject({ input_tokens: 10, output_tokens: 5 });
  });

  it("maps stop -> end_turn and length -> max_tokens", () => {
    const stopBody = structuredClone(CHAT_BODY);
    stopBody.choices[0].finish_reason = "stop";
    stopBody.choices[0].message.tool_calls = [];
    expect(openAICompletionToClaudeMessage(stopBody).stop_reason).toBe("end_turn");

    const lengthBody = structuredClone(CHAT_BODY);
    lengthBody.choices[0].finish_reason = "length";
    lengthBody.choices[0].message.tool_calls = [];
    expect(openAICompletionToClaudeMessage(lengthBody).stop_reason).toBe("max_tokens");
  });

  it("tolerates stringified and malformed tool arguments", () => {
    const body = structuredClone(CHAT_BODY);
    body.choices[0].message.tool_calls = [
      { id: "call_bad", type: "function", function: { name: "shell", arguments: "{not-json" } }
    ];
    const out = openAICompletionToClaudeMessage(body);
    const tool = (out.content || []).find((b) => b.type === "tool_use");
    expect(tool).toMatchObject({ id: "call_bad", name: "shell", input: {} });
  });
});

describe("completionConverters status unification (Chat -> Responses)", () => {
  it("maps stop/tool_calls to completed", () => {
    const stop = structuredClone(CHAT_BODY);
    stop.choices[0].finish_reason = "stop";
    expect(openAICompletionToResponses(stop).status).toBe("completed");

    const tool = structuredClone(CHAT_BODY);
    tool.choices[0].finish_reason = "tool_calls";
    expect(openAICompletionToResponses(tool).status).toBe("completed");
  });

  it("propagates non-terminal finish_reason instead of hardcoding completed", () => {
    // Old sseToJsonHandler inline copy hardcoded status:"completed".
    // Shared converter propagates e.g. "length" — lock that in.
    const body = structuredClone(CHAT_BODY);
    body.choices[0].finish_reason = "length";
    expect(openAICompletionToResponses(body).status).toBe("length");
  });
});
