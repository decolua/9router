import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {})
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { translateNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");
const { handleForcedSSEToJson } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");
const { convertResponsesStreamToJson } = await import("../../open-sse/transformer/streamToJsonConverter.js");
const { createSSETransformStreamWithLogger } = await import("../../open-sse/utils/stream.js");

// A chat.completion body as returned by a chat-native upstream (e.g. op-ericding)
const CHAT_TOOL_BODY = {
  id: "chatcmpl-abc123",
  object: "chat.completion",
  created: 1700000000,
  model: "cl/claude-haiku-4-5",
  choices: [{
    index: 0,
    message: {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "call_1", type: "function", function: { name: "shell", arguments: "{\"cmd\":\"ls\"}" } }]
    },
    finish_reason: "tool_calls"
  }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
};

describe("non-stream Chat upstream for a Responses-API client (op-ericding bug)", () => {
  it("translates chat.completion tool_calls into Responses function_call output", () => {
    // translateNonStreamingResponse(body, targetFormat=PROVIDER format, sourceFormat=CLIENT format)
    const out = translateNonStreamingResponse(CHAT_TOOL_BODY, FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES);
    expect(out.object).toBe("response");
    expect(out).not.toHaveProperty("choices");
    const fc = (out.output || []).find((o) => o.type === "function_call");
    expect(fc).toBeTruthy();
    expect(fc.call_id).toBe("call_1");
    expect(fc.name).toBe("shell");
    expect(fc.arguments).toBe("{\"cmd\":\"ls\"}");
  });

  it("translates marked Chat tools into Responses custom_tool_call output", () => {
    const customBody = structuredClone(CHAT_TOOL_BODY);
    customBody.choices[0].message.tool_calls[0] = {
      id: "call_exec",
      type: "function",
      function: {
        name: "exec",
        arguments: "{\"input\":\"return await tools.shell({command: 'pwd'});\"}"
      }
    };
    const out = translateNonStreamingResponse(
      customBody,
      FORMATS.OPENAI,
      FORMATS.OPENAI_RESPONSES,
      new Set(["exec"])
    );
    const call = (out.output || []).find((item) => item.type === "custom_tool_call");
    expect(call).toMatchObject({
      call_id: "call_exec",
      name: "exec",
      input: "return await tools.shell({command: 'pwd'});"
    });
    expect(out.output.some((item) => item.type === "function_call")).toBe(false);
  });

  it("keeps chat.completion text content as a Responses message item", () => {
    const body = {
      ...CHAT_TOOL_BODY,
      choices: [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" }]
    };
    const out = translateNonStreamingResponse(body, FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES);
    const msg = (out.output || []).find((o) => o.type === "message");
    expect(msg).toBeTruthy();
    expect(msg.content[0].type).toBe("output_text");
    expect(msg.content[0].text).toBe("hello");
  });

  it("chains Antigravity response conversion into Responses output", () => {
    const body = {
      response: {
        responseId: "ag-resp-1",
        modelVersion: "gemini-3.7-flash-low",
        candidates: [{
          content: { parts: [{ text: "hello from antigravity" }] },
          finishReason: "STOP",
        }],
      },
    };
    const out = translateNonStreamingResponse(body, FORMATS.ANTIGRAVITY, FORMATS.OPENAI_RESPONSES);

    expect(out.object).toBe("response");
    expect(out).not.toHaveProperty("choices");
    const msg = (out.output || []).find((item) => item.type === "message");
    expect(msg?.content?.[0]).toMatchObject({
      type: "output_text",
      text: "hello from antigravity",
    });
  });

  it("preserves cached input tokens when converting Chat usage", () => {
    const body = {
      ...CHAT_TOOL_BODY,
      usage: {
        prompt_tokens: 100,
        completion_tokens: 5,
        total_tokens: 105,
        prompt_tokens_details: { cached_tokens: 80, cache_creation_tokens: 7 },
      },
    };
    const out = translateNonStreamingResponse(body, FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES);
    expect(out.usage).toMatchObject({
      input_tokens: 100,
      input_tokens_details: { cached_tokens: 80 },
      cache_creation_input_tokens: 7,
    });
  });

  it("leaves chat->chat untouched", () => {
    const out = translateNonStreamingResponse(CHAT_TOOL_BODY, FORMATS.OPENAI, FORMATS.OPENAI);
    expect(out.object).toBe("chat.completion");
    expect(out.choices[0].message.tool_calls[0].function.name).toBe("shell");
  });
});

describe("Responses stream JSON usage", () => {
  it("preserves cache details from response.completed", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":100,"output_tokens":5,"total_tokens":105,"input_tokens_details":{"cached_tokens":80},"cache_creation_input_tokens":7}}}\n\n'));
        controller.close();
      },
    });
    const out = await convertResponsesStreamToJson(stream);
    expect(out.usage).toMatchObject({
      input_tokens: 100,
      input_tokens_details: { cached_tokens: 80 },
      cache_creation_input_tokens: 7,
    });
  });
});

describe("Antigravity streaming tool calls for a Responses-API client", () => {
  it("emits a Responses function_call instead of an empty stream", async () => {
    const encoder = new TextEncoder();
    const raw = [
      'data: {"response":{"responseId":"ag-tool","modelVersion":"gemini-3.7-flash-low","candidates":[{"content":{"parts":[{"functionCall":{"name":"read_file","args":{"path":"README.md"},"thoughtSignature":"sig"}}]}}]}}',
      'data: {"response":{"responseId":"ag-tool","modelVersion":"gemini-3.7-flash-low","candidates":[{"content":{"parts":[]},"finishReason":"STOP"}]}}',
      "data: [DONE]",
      ""
    ].join("\n\n");
    const input = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(raw));
        controller.close();
      }
    });
    const output = input.pipeThrough(createSSETransformStreamWithLogger(
      FORMATS.ANTIGRAVITY,
      FORMATS.OPENAI_RESPONSES,
      "antigravity",
      { appendProviderChunk() {}, appendConvertedChunk() {} },
      null,
      "gemini-3.7-flash-low",
      "test-connection",
      { messages: [] },
      null,
      "test-key",
    ));
    const text = await new Response(output).text();
    expect(text).toContain('"type":"response.output_item.added"');
    expect(text).toContain('"type":"function_call"');
    expect(text).toContain('"name":"read_file"');
    expect(text).toContain('"type":"response.completed"');
    const completedLine = text.split("\n").find((line) => line.startsWith("data: {") && line.includes('"type":"response.completed"'));
    const completed = JSON.parse(completedLine.slice(6));
    expect(completed.response.output).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "function_call",
        name: "read_file",
        arguments: '{"path":"README.md"}',
      }),
    ]));
  });
});

describe("forced-SSE JSON path for a Responses-API client behind a chat upstream", () => {
  const sseCtx = (sourceFormat, targetFormat) => {
    const encoder = new TextEncoder();
    const raw = [
      'data: {"id":"chatcmpl-sse","object":"chat.completion.chunk","created":1700000000,"model":"gpt-x","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_9","type":"function","function":{"name":"shell","arguments":""}}]},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-sse","object":"chat.completion.chunk","created":1700000000,"model":"gpt-x","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"cmd\\":\\"pwd\\"}"}}]},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-sse","object":"chat.completion.chunk","created":1700000000,"model":"gpt-x","choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
      "data: [DONE]",
      ""
    ].join("\n\n");
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
      clientRawRequest: { endpoint: "/v1/responses" },
      trackDone: vi.fn(),
      appendLog: vi.fn()
    };
  };

  it("parses chat SSE chunks and returns a Responses function_call body", async () => {
    const result = await handleForcedSSEToJson(sseCtx(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI));
    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.object).toBe("response");
    const fc = (json.output || []).find((o) => o.type === "function_call");
    expect(fc).toBeTruthy();
    expect(fc.name).toBe("shell");
    expect(fc.arguments).toBe("{\"cmd\":\"pwd\"}");
  });

  it("returns a custom_tool_call for a marked tool", async () => {
    const ctx = sseCtx(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI);
    ctx.customToolNames = new Set(["shell"]);
    const result = await handleForcedSSEToJson(ctx);
    expect(result.success).toBe(true);
    const json = await result.response.json();
    const call = (json.output || []).find((item) => item.type === "custom_tool_call");
    expect(call).toMatchObject({
      call_id: "call_9",
      name: "shell",
      input: "{\"cmd\":\"pwd\"}"
    });
  });

  it("still returns chat.completion for a plain chat client", async () => {
    const result = await handleForcedSSEToJson(sseCtx(FORMATS.OPENAI, FORMATS.OPENAI));
    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.object).toBe("chat.completion");
    expect(json.choices[0].message.tool_calls[0].function.name).toBe("shell");
  });

  it("converts forced Antigravity SSE into Responses JSON", async () => {
    const encoder = new TextEncoder();
    const raw = [
      'data: {"response":{"responseId":"ag-sse","modelVersion":"gemini-3.7-flash-low","candidates":[{"content":{"parts":[{"text":"hello from stream"}]}}]}}',
      'data: {"response":{"responseId":"ag-sse","modelVersion":"gemini-3.7-flash-low","candidates":[{"content":{"parts":[]},"finishReason":"STOP"}]}}',
      "data: [DONE]",
      ""
    ].join("\n\n");
    const result = await handleForcedSSEToJson({
      providerResponse: new Response(new ReadableStream({
        start(controller) { controller.enqueue(encoder.encode(raw)); controller.close(); }
      }), { headers: { "content-type": "text/event-stream" } }),
      sourceFormat: FORMATS.OPENAI_RESPONSES,
      targetFormat: FORMATS.ANTIGRAVITY,
      provider: "antigravity",
      model: "gemini-3.7-flash-low",
      body: { model: "combo-ui", input: "hello" },
      stream: false,
      translatedBody: null,
      finalBody: null,
      requestStartTime: Date.now(),
      connectionId: "test-connection",
      apiKey: "test-key",
      clientRawRequest: { endpoint: "/v1/responses" },
      onRequestSuccess: vi.fn(),
      customToolNames: null,
      trackDone: vi.fn(),
      appendLog: vi.fn(),
      reqTag: "test",
      log: null,
    });
    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.object).toBe("response");
    expect(json.output?.[0]?.content?.[0]).toMatchObject({
      type: "output_text",
      text: "hello from stream",
    });
  });
});
