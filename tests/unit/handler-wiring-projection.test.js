import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {})
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { handleNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");
const { handleForcedSSEToJson, parseSSEToOpenAIResponse } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");

function reqLogger() {
  return { logProviderResponse() {}, logConvertedResponse() {} };
}

function handlerCtx(overrides) {
  return {
    provider: "op-test-chat",
    model: "gpt-x",
    body: { model: "gpt-x", messages: [] },
    stream: false,
    requestStartTime: Date.now(),
    connectionId: "test-connection",
    clientRawRequest: { endpoint: "/v1/messages" },
    trackDone: vi.fn(),
    appendLog: vi.fn(),
    reqLogger: reqLogger(),
    ...overrides
  };
}

const OPENAI_REASONING_AND_CONTENT = {
  id: "chatcmpl-r",
  object: "chat.completion",
  created: 1700000000,
  model: "gpt-x",
  choices: [{
    index: 0,
    message: {
      role: "assistant",
      content: "answer",
      reasoning_content: "thought"
    },
    finish_reason: "stop"
  }],
  usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 }
};

describe("handler-wiring: Claude client + reasoning and content", () => {
  it("projects thinking and text from a non-streaming OpenAI body", async () => {
    const result = await handleNonStreamingResponse(handlerCtx({
      sourceFormat: FORMATS.CLAUDE,
      targetFormat: FORMATS.OPENAI,
      providerResponse: new Response(JSON.stringify(OPENAI_REASONING_AND_CONTENT), {
        headers: { "content-type": "application/json" }
      })
    }));

    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.type).toBe("message");
    expect(json.content.map((part) => part.type)).toEqual(["thinking", "text"]);
    expect(json.content[0].thinking).toBe("thought");
    expect(json.content[1].text).toBe("answer");
  });
});

describe("handler-wiring: Responses client + Chat Completions SSE", () => {
  it("stays on the chat SSE path and returns Responses output", async () => {
    const raw = [
      'data: {"id":"chatcmpl-sse","object":"chat.completion.chunk","created":1700000000,"model":"gpt-x","choices":[{"delta":{"reasoning_content":"thought"},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-sse","object":"chat.completion.chunk","created":1700000000,"model":"gpt-x","choices":[{"delta":{"content":"answer"},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-sse","object":"chat.completion.chunk","created":1700000000,"model":"gpt-x","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_9","type":"function","function":{"name":"shell","arguments":"{\\"cmd\\":\\"pwd\\"}"}}]},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-sse","object":"chat.completion.chunk","created":1700000000,"model":"gpt-x","choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
      "data: [DONE]",
      ""
    ].join("\n\n");
    const encoder = new TextEncoder();
    const result = await handleForcedSSEToJson(handlerCtx({
      sourceFormat: FORMATS.OPENAI_RESPONSES,
      targetFormat: FORMATS.OPENAI,
      clientRawRequest: { endpoint: "/v1/responses" },
      providerResponse: new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(raw));
          controller.close();
        }
      }), { headers: { "content-type": "text/event-stream" } })
    }));

    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.object).toBe("response");
    expect(json.output.map((item) => item.type)).toEqual(["reasoning", "message", "function_call"]);
    expect(json.output[0].summary[0].text).toBe("thought");
    expect(json.output[1].content[0].text).toBe("answer");
    expect(json.output[2]).toMatchObject({
      type: "function_call",
      call_id: "call_9",
      name: "shell",
      arguments: "{\"cmd\":\"pwd\"}"
    });
  });
});

describe("handler-wiring: SSE error inside HTTP 200", () => {
  it("does not collapse a terminal chunk.error into a successful completion", () => {
    const raw = [
      'data: {"choices":[{"delta":{"content":"partial"},"finish_reason":null}]}',
      'data: {"error":{"message":"upstream failed","code":"stream_error"}}',
      "data: [DONE]"
    ].join("\n\n");
    expect(parseSSEToOpenAIResponse(raw, "gpt-x")).toEqual({
      error: { message: "upstream failed", code: "stream_error" }
    });
  });
});
