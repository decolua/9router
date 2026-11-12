import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {})
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { translateNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");
const { ollamaBodyToOpenAI } = await import("../../open-sse/translator/response/ollama-to-openai.js");

// translateNonStreamingResponse(responseBody, targetFormat = UPSTREAM format, sourceFormat = CLIENT format)

// An Ollama-native non-streaming body as returned by an ollama-local upstream.
const OLLAMA_BODY = {
  model: "gemma3:4b",
  created_at: "2026-09-16T00:00:00Z",
  message: { role: "assistant", content: "pong" },
  done: true,
  done_reason: "stop",
  prompt_eval_count: 11,
  eval_count: 3
};

const OLLAMA_TOOL_BODY = {
  model: "qwen3:8b",
  message: {
    role: "assistant",
    content: "",
    tool_calls: [{ function: { name: "get_weather", arguments: { city: "Bogota" } } }]
  },
  done: true,
  done_reason: "stop",
  prompt_eval_count: 21,
  eval_count: 7
};

// A Gemini-shaped non-streaming upstream body (candidates[]/parts[]).
const GEMINI_BODY = {
  candidates: [{
    content: { role: "model", parts: [{ text: "pong" }] },
    finishReason: "STOP",
    index: 0
  }],
  usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 2, totalTokenCount: 11 },
  modelVersion: "gemini-3.5-pro",
  responseId: "gem-1"
};

// A Claude-format (Anthropic Messages) upstream body.
const CLAUDE_BODY = {
  id: "msg_01abc",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-4-5",
  content: [{ type: "text", text: "hi" }],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 5, output_tokens: 2 }
};

describe("non-streaming upstream body → Anthropic (/v1/messages) client", () => {
  it("(a) converts an Ollama-shaped upstream body into an Anthropic message", () => {
    // What the Ollama branch produces: an OpenAI chat.completion body, which the
    // Anthropic client cannot parse (it reads content[], never choices[]).
    const converted = ollamaBodyToOpenAI(OLLAMA_BODY);
    expect(converted.object).toBe("chat.completion");
    expect(converted.choices[0].message.content).toBe("pong");

    const out = translateNonStreamingResponse(OLLAMA_BODY, FORMATS.OLLAMA, FORMATS.CLAUDE);

    expect(out.type).toBe("message");
    expect(out.role).toBe("assistant");
    expect(out.content[0]).toEqual({ type: "text", text: "pong" });
    expect(typeof out.usage.input_tokens).toBe("number");
    expect(typeof out.usage.output_tokens).toBe("number");
    expect(out).not.toHaveProperty("choices");
    expect(out).not.toHaveProperty("object");
  });

  it("(b) converts Ollama tool_calls into Anthropic tool_use blocks with parsed input", () => {
    const out = translateNonStreamingResponse(OLLAMA_TOOL_BODY, FORMATS.OLLAMA, FORMATS.CLAUDE);

    expect(out.type).toBe("message");
    expect(out).not.toHaveProperty("choices");
    const toolUse = out.content.find((block) => block.type === "tool_use");
    expect(toolUse).toBeTruthy();
    expect(toolUse.name).toBe("get_weather");
    expect(toolUse.input).toEqual({ city: "Bogota" });
    expect(out.stop_reason).toBe("tool_use");
  });

  it("(c) converts a Gemini-shaped upstream body into an Anthropic message", () => {
    const out = translateNonStreamingResponse(GEMINI_BODY, FORMATS.GEMINI, FORMATS.CLAUDE);

    expect(out.type).toBe("message");
    expect(out.role).toBe("assistant");
    expect(out.content[0]).toEqual({ type: "text", text: "pong" });
    expect(out).not.toHaveProperty("choices");
    expect(out).not.toHaveProperty("object");
    expect(typeof out.usage.input_tokens).toBe("number");
    expect(typeof out.usage.output_tokens).toBe("number");
  });

  it("(d) guard: an OpenAI-format client still gets chat.completion from an Ollama upstream", () => {
    const out = translateNonStreamingResponse(OLLAMA_BODY, FORMATS.OLLAMA, FORMATS.OPENAI);

    expect(out.object).toBe("chat.completion");
    expect(Array.isArray(out.choices)).toBe(true);
    expect(out.choices[0].message.content).toBe("pong");
    expect(out.type).toBeUndefined();
  });

  it("(e) guard: a Claude-format upstream body still translates into choices[] for an OpenAI client", () => {
    const out = translateNonStreamingResponse(CLAUDE_BODY, FORMATS.CLAUDE, FORMATS.OPENAI);

    expect(out.object).toBe("chat.completion");
    expect(out.choices[0].message.content).toBe("hi");
    expect(out.choices[0].finish_reason).toBe("stop");
    expect(out.type).toBeUndefined();
  });

  it("(f) a chat-native upstream body for a Claude client becomes an Anthropic message", () => {
    const chatBody = ollamaBodyToOpenAI(OLLAMA_BODY); // any OpenAI chat.completion body
    const out = translateNonStreamingResponse(chatBody, FORMATS.OPENAI, FORMATS.CLAUDE);

    expect(out.type).toBe("message");
    expect(out.role).toBe("assistant");
    expect(out.content[0]).toEqual({ type: "text", text: "pong" });
    expect(out).not.toHaveProperty("choices");
  });

  it("guard: a Claude-format upstream body for a Claude client is returned untouched", () => {
    const out = translateNonStreamingResponse(CLAUDE_BODY, FORMATS.CLAUDE, FORMATS.CLAUDE);

    expect(out).toBe(CLAUDE_BODY);
    expect(out.type).toBe("message");
    expect(out.content[0]).toEqual({ type: "text", text: "hi" });
  });

  it("guard: an already-Claude upstream body on an unmapped target is not mangled", () => {
    const out = translateNonStreamingResponse(CLAUDE_BODY, FORMATS.KIRO, FORMATS.CLAUDE);

    expect(out.type).toBe("message");
    expect(out.content[0]).toEqual({ type: "text", text: "hi" });
  });
});
