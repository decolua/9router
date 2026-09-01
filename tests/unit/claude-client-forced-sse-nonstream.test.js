import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {})
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { handleForcedSSEToJson } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");

const encoder = new TextEncoder();

function sseResponse(lines) {
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(lines.concat("data: [DONE]", "").join("\n\n")));
      controller.close();
    }
  }), { headers: { "content-type": "text/event-stream" } });
}

function baseCtx(providerResponse, overrides = {}) {
  return {
    providerResponse,
    sourceFormat: FORMATS.CLAUDE,
    provider: "op-test-chat",
    model: "gpt-x",
    body: { model: "gpt-x", messages: [] },
    stream: false,
    requestStartTime: Date.now(),
    connectionId: "test-connection",
    clientRawRequest: { endpoint: "/v1/messages" },
    trackDone: vi.fn(),
    appendLog: vi.fn(),
    ...overrides
  };
}

const CHAT_SSE = [
  'data: {"id":"chatcmpl-sse","object":"chat.completion.chunk","created":1700000000,"model":"gpt-x","choices":[{"delta":{"content":"hi"},"finish_reason":null}]}',
  'data: {"id":"chatcmpl-sse","object":"chat.completion.chunk","created":1700000000,"model":"gpt-x","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_9","type":"function","function":{"name":"shell","arguments":"{\\"cmd\\":\\"pwd\\"}"}}]},"finish_reason":null}]}',
  'data: {"id":"chatcmpl-sse","object":"chat.completion.chunk","created":1700000000,"model":"gpt-x","choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":10,"completion_tokens":5}}'
];

const RESPONSES_SSE = [
  'event: response.created\ndata: {"response":{"id":"resp_1","created_at":1700000000}}',
  'event: response.output_item.done\ndata: {"output_index":0,"item":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"hi"}]}}',
  'event: response.output_item.done\ndata: {"output_index":1,"item":{"type":"function_call","call_id":"call_9","name":"shell","arguments":"{\\"cmd\\":\\"pwd\\"}"}}',
  'event: response.completed\ndata: {"response":{"id":"resp_1","model":"gpt-x","status":"completed","usage":{"input_tokens":10,"output_tokens":5}}}'
];

describe("forced-SSE JSON path for a Claude client", () => {
  it("returns an Anthropic Message from a chat-completions upstream", async () => {
    const result = await handleForcedSSEToJson(
      baseCtx(sseResponse(CHAT_SSE), { targetFormat: FORMATS.OPENAI })
    );

    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.type).toBe("message");
    expect(json.object).toBeUndefined();
    expect(json.role).toBe("assistant");
    expect(json.stop_reason).toBe("tool_use");
    expect(json.content).toEqual([
      { type: "text", text: "hi" },
      { type: "tool_use", id: "call_9", name: "shell", input: { cmd: "pwd" } }
    ]);
    expect(json.usage).toMatchObject({ input_tokens: 10, output_tokens: 5 });
  });

  it("returns an Anthropic Message from a Responses-API upstream", async () => {
    const result = await handleForcedSSEToJson(
      baseCtx(sseResponse(RESPONSES_SSE), { targetFormat: FORMATS.OPENAI_RESPONSES })
    );

    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.type).toBe("message");
    expect(json.object).toBeUndefined();
    expect(json.stop_reason).toBe("tool_use");
    const toolUse = json.content.find((block) => block.type === "tool_use");
    expect(toolUse).toMatchObject({ id: "call_9", name: "shell", input: { cmd: "pwd" } });
  });

  it("still returns chat.completion for a plain chat client", async () => {
    const result = await handleForcedSSEToJson(
      baseCtx(sseResponse(CHAT_SSE), { sourceFormat: FORMATS.OPENAI, targetFormat: FORMATS.OPENAI })
    );

    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.object).toBe("chat.completion");
    expect(json.choices[0].message.tool_calls[0].function.name).toBe("shell");
  });
});
