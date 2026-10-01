import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {})
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { handleForcedSSEToJson } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");

function chatSseCtx(sourceFormat, targetFormat, lines) {
  const encoder = new TextEncoder();
  const raw = lines.join("\n\n");
  return {
    providerResponse: new Response(new ReadableStream({
      start(controller) { controller.enqueue(encoder.encode(raw)); controller.close(); }
    }), { headers: { "content-type": "text/event-stream" } }),
    sourceFormat,
    targetFormat,
    provider: "op-test-chat",
    model: "gpt-x",
    body: { model: "gpt-x", messages: [] },
    stream: false,
    requestStartTime: Date.now(),
    connectionId: "test-connection",
    clientRawRequest: { endpoint: "/v1/messages" },
    trackDone: vi.fn(),
    appendLog: vi.fn()
  };
}

const TEXT_SSE = [
  'data: {"id":"chatcmpl-sse","object":"chat.completion.chunk","created":1700000000,"model":"gpt-x","choices":[{"delta":{"content":"hello"},"finish_reason":null}]}',
  'data: {"id":"chatcmpl-sse","object":"chat.completion.chunk","created":1700000000,"model":"gpt-x","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}',
  "data: [DONE]",
  ""
];

const TOOL_SSE = [
  'data: {"id":"chatcmpl-sse","object":"chat.completion.chunk","created":1700000000,"model":"gpt-x","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_9","type":"function","function":{"name":"shell","arguments":""}}]},"finish_reason":null}]}',
  'data: {"id":"chatcmpl-sse","object":"chat.completion.chunk","created":1700000000,"model":"gpt-x","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"cmd\\":\\"pwd\\"}"}}]},"finish_reason":null}]}',
  'data: {"id":"chatcmpl-sse","object":"chat.completion.chunk","created":1700000000,"model":"gpt-x","choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
  "data: [DONE]",
  ""
];

function responsesSseCtx(sourceFormat, provider = "codex") {
  const encoder = new TextEncoder();
  const events = [
    'event: response.created\ndata: {"type":"response.created","response":{"id":"resp_abc","created_at":1700000000,"model":"gpt-x","status":"in_progress"}}',
    'event: response.output_item.done\ndata: {"type":"response.output_item.done","output_index":0,"item":{"type":"reasoning","summary":[{"type":"summary_text","text":"let me think"}]}}',
    'event: response.output_item.done\ndata: {"type":"response.output_item.done","output_index":1,"item":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"hello"}]}}',
    'event: response.output_item.done\ndata: {"type":"response.output_item.done","output_index":2,"item":{"type":"function_call","call_id":"call_7","name":"shell","arguments":"{\\"cmd\\":\\"pwd\\"}"}}',
    'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_abc","status":"completed","usage":{"input_tokens":50,"output_tokens":8,"total_tokens":58}}}',
    ""
  ].join("\n\n");
  return {
    providerResponse: new Response(new ReadableStream({
      start(controller) { controller.enqueue(encoder.encode(events)); controller.close(); }
    }), { headers: { "content-type": "text/event-stream" } }),
    sourceFormat,
    targetFormat: FORMATS.OPENAI_RESPONSES,
    provider,
    model: "gpt-x",
    body: { model: "gpt-x", messages: [] },
    stream: false,
    requestStartTime: Date.now(),
    connectionId: "test-connection",
    clientRawRequest: { endpoint: "/v1/messages" },
    trackDone: vi.fn(),
    appendLog: vi.fn()
  };
}

describe("forced-SSE JSON path for a Claude client (/v1/messages non-stream)", () => {
  it("returns a Claude message for text", async () => {
    const result = await handleForcedSSEToJson(chatSseCtx(FORMATS.CLAUDE, FORMATS.OPENAI, TEXT_SSE));
    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.type).toBe("message");
    expect(json).not.toHaveProperty("choices");
    expect(json.content).toEqual([{ type: "text", text: "hello" }]);
    expect(json.stop_reason).toBe("end_turn");
    expect(json.usage).toMatchObject({ input_tokens: 10, output_tokens: 5 });
  });

  it("returns tool_use blocks for tool calls", async () => {
    const result = await handleForcedSSEToJson(chatSseCtx(FORMATS.CLAUDE, FORMATS.OPENAI, TOOL_SSE));
    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.type).toBe("message");
    const tool = (json.content || []).find((b) => b.type === "tool_use");
    expect(tool).toMatchObject({ id: "call_9", name: "shell", input: { cmd: "pwd" } });
    expect(json.stop_reason).toBe("tool_use");
  });

  it("still returns chat.completion for a plain OpenAI client", async () => {
    const result = await handleForcedSSEToJson(chatSseCtx(FORMATS.OPENAI, FORMATS.OPENAI, TEXT_SSE));
    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.object).toBe("chat.completion");
  });

  it("converts a Responses provider stream (codex) into thinking + text + tool_use", async () => {
    const result = await handleForcedSSEToJson(responsesSseCtx(FORMATS.CLAUDE));
    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.type).toBe("message");
    expect(json).not.toHaveProperty("choices");
    expect(json).not.toHaveProperty("output");
    const kinds = (json.content || []).map((b) => b.type);
    expect(kinds).toEqual(["thinking", "text", "tool_use"]);
    expect(json.content[0]).toMatchObject({ type: "thinking", thinking: "let me think" });
    expect(json.content[1]).toMatchObject({ type: "text", text: "hello" });
    expect(json.content[2]).toMatchObject({ id: "call_7", name: "shell", input: { cmd: "pwd" } });
    expect(json.stop_reason).toBe("tool_use");
    expect(json.usage).toMatchObject({ input_tokens: 50, output_tokens: 8 });
  });
});
