import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {})
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { translateNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");

// The kiro executor decodes its EventStream frames into a chat.completion body
// before chatCore ever sees them, so translateNonStreamingResponse is handed
// OpenAI shape under targetFormat "kiro".
const KIRO_DECODED_BODY = {
  id: "chatcmpl-1786352438097",
  object: "chat.completion",
  created: 1786352438,
  model: "claude-haiku-4.5",
  choices: [{
    index: 0,
    message: { role: "assistant", content: "Hey there." },
    finish_reason: "stop",
  }],
  usage: { prompt_tokens: 10, completion_tokens: 8 },
};

const KIRO_TOOL_BODY = {
  id: "chatcmpl-tool",
  object: "chat.completion",
  model: "claude-haiku-4.5",
  choices: [{
    index: 0,
    message: {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "toolu_1", type: "function", function: { name: "Read", arguments: '{"path":"a.txt"}' } }],
    },
    finish_reason: "tool_calls",
  }],
  usage: {},
};

describe("#3199 non-streaming responses from binary-transport targets", () => {
  it("returns an Anthropic message to a Claude client", () => {
    const out = translateNonStreamingResponse(KIRO_DECODED_BODY, FORMATS.KIRO, FORMATS.CLAUDE);

    expect(out.type).toBe("message");
    expect(out.role).toBe("assistant");
    expect(out.content).toEqual([{ type: "text", text: "Hey there." }]);
    expect(out.stop_reason).toBe("end_turn");
    expect(out.usage).toEqual({ input_tokens: 10, output_tokens: 8 });
    expect(out.choices).toBeUndefined();
  });

  it("maps tool calls to tool_use blocks for a Claude client", () => {
    const out = translateNonStreamingResponse(KIRO_TOOL_BODY, FORMATS.KIRO, FORMATS.CLAUDE);

    expect(out.content).toEqual([
      { type: "tool_use", id: "toolu_1", name: "Read", input: { path: "a.txt" } },
    ]);
    expect(out.stop_reason).toBe("tool_use");
  });

  it("returns a Responses body to a Responses client", () => {
    const out = translateNonStreamingResponse(KIRO_DECODED_BODY, FORMATS.KIRO, FORMATS.OPENAI_RESPONSES);

    expect(out.object).toBe("response");
    expect(out.output).toEqual([{
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Hey there.", annotations: [] }],
    }]);
  });

  it("leaves an OpenAI client's body untouched", () => {
    const out = translateNonStreamingResponse(KIRO_DECODED_BODY, FORMATS.KIRO, FORMATS.OPENAI);

    expect(out).toBe(KIRO_DECODED_BODY);
  });

  it("does not touch a body that has no choices array", () => {
    const raw = { some: "proprietary shape" };
    const out = translateNonStreamingResponse(raw, FORMATS.KIRO, FORMATS.CLAUDE);

    expect(out).toBe(raw);
  });
});
