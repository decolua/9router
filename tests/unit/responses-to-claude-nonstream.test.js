import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const {
  translateNonStreamingResponse,
  handleNonStreamingResponse,
  responsesToOpenAICompletion,
  responsesToClaudeMessage,
} = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");
const { extractTextFromResponsesOutput } = await import("../../open-sse/handlers/chatCore/responseFormats.js");
const { handleForcedSSEToJson } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");
const { parseResponsesSSEToJSON } = await import("../../open-sse/transformer/streamToJsonConverter.js");

const RESPONSES_TEXT_BODY = {
  id: "resp_abc123",
  object: "response",
  created_at: 1700000000,
  model: "muse-spark-1.3-contributor",
  status: "completed",
  output: [
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Hello from muse-spark 1.3!" }],
    },
  ],
  usage: { input_tokens: 12, output_tokens: 7, total_tokens: 19 },
};

const RESPONSES_THINKING_BODY = {
  id: "resp_think456",
  object: "response",
  created_at: 1700000000,
  model: "muse-spark-1.3-contributor",
  status: "completed",
  output: [
    {
      type: "reasoning",
      summary: [{ type: "summary_text", text: "Thinking step by step..." }],
    },
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Here is the final answer." }],
    },
  ],
  usage: { input_tokens: 20, output_tokens: 15, total_tokens: 35 },
};

const RESPONSES_TOOL_BODY = {
  id: "resp_tool789",
  object: "response",
  created_at: 1700000000,
  model: "muse-spark-1.3-contributor",
  status: "completed",
  output: [
    {
      type: "function_call",
      id: "fc_1",
      call_id: "call_weather_1",
      name: "get_weather",
      arguments: '{"city":"Tokyo"}',
    },
    {
      type: "function_call",
      id: "fc_2",
      call_id: "call_weather_2",
      name: "get_weather",
      arguments: '{"city":"Kyoto"}',
    },
  ],
  usage: { input_tokens: 25, output_tokens: 30, total_tokens: 55 },
};

describe("translateNonStreamingResponse for Responses API upstream", () => {
  it("translates Responses text response to Claude Message for Claude client", () => {
    const out = translateNonStreamingResponse(RESPONSES_TEXT_BODY, FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE);
    expect(out.type).toBe("message");
    expect(out.role).toBe("assistant");
    expect(out.model).toBe("muse-spark-1.3-contributor");
    expect(out.content).toEqual([{ type: "text", text: "Hello from muse-spark 1.3!" }]);
    expect(out.stop_reason).toBe("end_turn");
    expect(out.usage).toEqual({ input_tokens: 12, output_tokens: 7 });
  });

  it("translates Responses reasoning + text response to Claude Message with thinking block", () => {
    const out = translateNonStreamingResponse(RESPONSES_THINKING_BODY, FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE);
    expect(out.type).toBe("message");
    expect(out.role).toBe("assistant");
    expect(out.content).toHaveLength(2);
    expect(out.content[0]).toEqual({ type: "thinking", thinking: "Thinking step by step..." });
    expect(out.content[1]).toEqual({ type: "text", text: "Here is the final answer." });
    expect(out.stop_reason).toBe("end_turn");
  });

  it("translates Responses tool calls to Claude Message with tool_use blocks and stop_reason tool_use", () => {
    const out = translateNonStreamingResponse(RESPONSES_TOOL_BODY, FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE);
    expect(out.type).toBe("message");
    expect(out.role).toBe("assistant");
    expect(out.stop_reason).toBe("tool_use");
    expect(out.content).toHaveLength(2);
    expect(out.content[0]).toEqual({
      type: "tool_use",
      id: "call_weather_1",
      name: "get_weather",
      input: { city: "Tokyo" },
    });
    expect(out.content[1]).toEqual({
      type: "tool_use",
      id: "call_weather_2",
      name: "get_weather",
      input: { city: "Kyoto" },
    });
  });

  it("translates Responses API response to OpenAI chat.completion for OpenAI client", () => {
    const out = translateNonStreamingResponse(RESPONSES_TOOL_BODY, FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI);
    expect(out.object).toBe("chat.completion");
    expect(out.choices[0].finish_reason).toBe("tool_calls");
    expect(out.choices[0].message.tool_calls).toHaveLength(2);
    expect(out.choices[0].message.tool_calls[0]).toEqual({
      id: "call_weather_1",
      type: "function",
      function: { name: "get_weather", arguments: '{"city":"Tokyo"}' },
    });
  });

  it("translates Gemini response to Claude Message for Claude client", () => {
    const geminiBody = {
      candidates: [
        {
          content: { parts: [{ text: "Gemini response text" }] },
          finishReason: "STOP",
        },
      ],
      usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 4, totalTokenCount: 12 },
    };
    const out = translateNonStreamingResponse(geminiBody, FORMATS.GEMINI, FORMATS.CLAUDE);
    expect(out.type).toBe("message");
    expect(out.content).toEqual([{ type: "text", text: "Gemini response text" }]);
    expect(out.stop_reason).toBe("end_turn");
  });

  it("translates Responses custom_tool_call to OpenAI chat tool_calls", () => {
    const customBody = {
      id: "resp_custom1",
      object: "response",
      created_at: 1700000000,
      model: "muse-spark-1.3-contributor",
      status: "completed",
      output: [
        {
          type: "custom_tool_call",
          id: "ctc_1",
          call_id: "call_exec_1",
          name: "exec",
          input: '{"cmd":"ls"}',
        },
      ],
      usage: { input_tokens: 30, output_tokens: 10, total_tokens: 40 },
    };
    const out = translateNonStreamingResponse(customBody, FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI);
    expect(out.object).toBe("chat.completion");
    expect(out.choices[0].finish_reason).toBe("tool_calls");
    expect(out.choices[0].message.tool_calls).toEqual([
      {
        id: "call_exec_1",
        type: "function",
        function: { name: "exec", arguments: '{"cmd":"ls"}' },
      },
    ]);
  });

  it("translates Responses custom_tool_call to Claude tool_use block", () => {
    const customBody = {
      id: "resp_custom2",
      object: "response",
      created_at: 1700000000,
      model: "muse-spark-1.3-contributor",
      status: "completed",
      output: [
        {
          type: "custom_tool_call",
          id: "ctc_1",
          call_id: "call_exec_1",
          name: "exec",
          input: '{"cmd":"ls"}',
        },
      ],
      usage: { input_tokens: 30, output_tokens: 10, total_tokens: 40 },
    };
    const out = translateNonStreamingResponse(customBody, FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE);
    expect(out.type).toBe("message");
    expect(out.stop_reason).toBe("tool_use");
    expect(out.content).toEqual([
      { type: "tool_use", id: "call_exec_1", name: "exec", input: { cmd: "ls" } },
    ]);
  });

  it("translates Ollama response to Claude Message for Claude client", () => {
    const ollamaBody = {
      model: "llama3",
      message: { role: "assistant", content: "Ollama says hi" },
      done_reason: "stop",
    };
    const out = translateNonStreamingResponse(ollamaBody, FORMATS.OLLAMA, FORMATS.CLAUDE);
    expect(out.type).toBe("message");
    expect(out.content).toEqual([{ type: "text", text: "Ollama says hi" }]);
    expect(out.stop_reason).toBe("end_turn");
  });

  it("handles Responses API cached tokens without inflating input_tokens or total_tokens", () => {
    const cachedBody = {
      id: "resp_cache_test",
      object: "response",
      created_at: 1700000000,
      model: "muse-spark-1.3-contributor",
      status: "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Response with cache" }],
        },
      ],
      usage: {
        input_tokens: 100,
        output_tokens: 25,
        total_tokens: 125,
        input_tokens_details: { cached_tokens: 40 },
      },
    };

    // 1. Convert to OpenAI chat.completion:
    // prompt_tokens must be 100 (not 140), total_tokens must be 125, cached_tokens in prompt_tokens_details
    const openAIOut = responsesToOpenAICompletion(cachedBody);
    expect(openAIOut.usage.prompt_tokens).toBe(100);
    expect(openAIOut.usage.completion_tokens).toBe(25);
    expect(openAIOut.usage.total_tokens).toBe(125);
    expect(openAIOut.usage.prompt_tokens_details).toEqual({ cached_tokens: 40 });

    // 2. Convert to Claude message:
    // input_tokens must be 100, output_tokens 25, cache_read_input_tokens 40
    const claudeOut = responsesToClaudeMessage(cachedBody);
    expect(claudeOut.type).toBe("message");
    expect(claudeOut.usage.input_tokens).toBe(100);
    expect(claudeOut.usage.output_tokens).toBe(25);
    expect(claudeOut.usage.cache_read_input_tokens).toBe(40);
  });


});

describe("handleNonStreamingResponse with Responses API upstream returning SSE", () => {
  const buildResponsesSSE = () => [
    'event: response.created\ndata: {"response":{"id":"resp_sse_1","model":"muse-spark-1.3-contributor","created_at":1700000000}}',
    'event: response.output_item.added\ndata: {"output_index":0,"item":{"id":"msg_0","type":"message","role":"assistant","content":[]}}',
    'event: response.output_text.delta\ndata: {"output_index":0,"delta":"Hello "}',
    'event: response.output_text.delta\ndata: {"output_index":0,"delta":"from SSE muse-spark!"}',
    'event: response.output_item.done\ndata: {"output_index":0,"item":{"id":"msg_0","type":"message","role":"assistant","content":[{"type":"output_text","text":"Hello from SSE muse-spark!"}]}}',
    'event: response.completed\ndata: {"response":{"id":"resp_sse_1","status":"completed","usage":{"input_tokens":15,"output_tokens":8,"total_tokens":23}}}',
    "data: [DONE]",
    "",
  ].join("\n\n");

  const buildResponsesToolSSE = () => [
    'event: response.created\ndata: {"response":{"id":"resp_sse_tools","model":"muse-spark-1.3-contributor","created_at":1700000000}}',
    'event: response.output_item.added\ndata: {"output_index":0,"item":{"id":"fc_0","type":"function_call","call_id":"call_read_1","name":"read_file","arguments":""}}',
    'event: response.function_call_arguments.delta\ndata: {"item_id":"fc_0","delta":"{\\"path\\":\\"/tmp/file.txt\\"}"}',
    'event: response.output_item.done\ndata: {"output_index":0,"item":{"id":"fc_0","type":"function_call","call_id":"call_read_1","name":"read_file","arguments":"{\\"path\\":\\"/tmp/file.txt\\"}"}}',
    'event: response.completed\ndata: {"response":{"id":"resp_sse_tools","status":"completed","usage":{"input_tokens":30,"output_tokens":12,"total_tokens":42}}}',
    "data: [DONE]",
    "",
  ].join("\n\n");

  const makeCtx = (sourceFormat, targetFormat, sseText) => ({
    providerResponse: new Response(sseText, { headers: { "content-type": "text/event-stream" } }),
    provider: "opencode-go",
    model: "muse-spark-1.3-contributor",
    sourceFormat,
    targetFormat,
    body: { model: "muse-spark-1.3-contributor", stream: false },
    stream: false,
    requestStartTime: Date.now(),
    connectionId: "conn-123",
    clientRawRequest: { endpoint: "/v1/messages" },
    reqLogger: {
      logProviderResponse: vi.fn(),
      logConvertedResponse: vi.fn(),
    },
    trackDone: vi.fn(),
    appendLog: vi.fn(),
  });

  it("handles non-streaming Claude request to opencode-go muse-spark 1.3 returning SSE text", async () => {
    const ctx = makeCtx(FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES, buildResponsesSSE());
    const result = await handleNonStreamingResponse(ctx);
    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.type).toBe("message");
    expect(json.role).toBe("assistant");
    expect(json.content).toEqual([{ type: "text", text: "Hello from SSE muse-spark!" }]);
    expect(json.stop_reason).toBe("end_turn");
    expect(json.usage).toEqual({ input_tokens: 2015, output_tokens: 8 });
  });

  it("handles non-streaming Claude request with tool calls returning SSE", async () => {
    const ctx = makeCtx(FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES, buildResponsesToolSSE());
    const result = await handleNonStreamingResponse(ctx);
    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.type).toBe("message");
    expect(json.stop_reason).toBe("tool_use");
    expect(json.content).toEqual([
      {
        type: "tool_use",
        id: "call_read_1",
        name: "read_file",
        input: { path: "/tmp/file.txt" },
      },
    ]);
  });

  it("handles non-streaming OpenAI chat request to Responses upstream returning SSE", async () => {
    const ctx = makeCtx(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, buildResponsesSSE());
    const result = await handleNonStreamingResponse(ctx);
    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.object).toBe("chat.completion");
    expect(json.choices[0].message.content).toBe("Hello from SSE muse-spark!");
    expect(json.choices[0].finish_reason).toBe("stop");
  });

  it("returns 502 when the Responses upstream SSE signals failure", async () => {
    const failedSSE = [
      'event: response.created\ndata: {"response":{"id":"resp_sse_fail","model":"muse-spark-1.3-contributor","created_at":1700000000}}',
      'event: response.failed\ndata: {"error":{"message":"upstream boom"}}',
      "data: [DONE]",
      "",
    ].join("\n\n");
    const ctx = makeCtx(FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES, failedSSE);
    const result = await handleNonStreamingResponse(ctx);
    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
  });
});

describe("handleForcedSSEToJson with Claude client", () => {
  const encoder = new TextEncoder();
  const responsesSSE = [
    'event: response.created\ndata: {"response":{"id":"resp_forced","model":"codex","created_at":1700000000}}',
    'event: response.output_item.added\ndata: {"output_index":0,"item":{"id":"msg_1","type":"message","role":"assistant","content":[]}}',
    'event: response.output_text.delta\ndata: {"output_index":0,"delta":"Codex forced stream result"}',
    'event: response.output_item.done\ndata: {"output_index":0,"item":{"id":"msg_1","type":"message","role":"assistant","content":[{"type":"output_text","text":"Codex forced stream result"}]}}',
    'event: response.completed\ndata: {"response":{"id":"resp_forced","status":"completed","usage":{"input_tokens":10,"output_tokens":6,"total_tokens":16}}}',
    "data: [DONE]",
    "",
  ].join("\n\n");

  it("returns Claude Message for Claude client on Responses-format forced SSE", async () => {
    const ctx = {
      providerResponse: new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(responsesSSE));
            controller.close();
          },
        }),
        { headers: { "content-type": "text/event-stream" } }
      ),
      sourceFormat: FORMATS.CLAUDE,
      targetFormat: FORMATS.OPENAI_RESPONSES,
      provider: "codex",
      model: "gpt-5-codex",
      body: { model: "gpt-5-codex", messages: [] },
      stream: false,
      requestStartTime: Date.now(),
      connectionId: "test-conn",
      clientRawRequest: { endpoint: "/v1/messages" },
      trackDone: vi.fn(),
      appendLog: vi.fn(),
    };

    const result = await handleForcedSSEToJson(ctx);
    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.type).toBe("message");
    expect(json.role).toBe("assistant");
    expect(json.content).toEqual([{ type: "text", text: "Codex forced stream result" }]);
    expect(json.stop_reason).toBe("end_turn");
  });
});


describe("parseResponsesSSEToJSON parser robustness", () => {
  it("parses raw SSE string without event headers", () => {
    const raw = [
      'data: {"type":"response.created","response":{"id":"resp_no_event","model":"m1"}}',
      'data: {"type":"response.output_item.done","output_index":0,"item":{"type":"message","content":[{"type":"output_text","text":"Parsed without event header"}]}}',
      'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":5,"output_tokens":5,"total_tokens":10}}}',
      "data: [DONE]",
      "",
    ].join("\n\n");
    const parsed = parseResponsesSSEToJSON(raw, "m1");
    expect(parsed).toBeTruthy();
    expect(parsed.id).toBe("resp_no_event");
    expect(parsed.output[0].content[0].text).toBe("Parsed without event header");
    expect(parsed.usage.total_tokens).toBe(10);
  });

  it("returns null on empty or non-event SSE", () => {
    expect(parseResponsesSSEToJSON("")).toBeNull();
    expect(parseResponsesSSEToJSON("data: [DONE]\n\n")).toBeNull();
    expect(parseResponsesSSEToJSON(": comment only\n\n")).toBeNull();
  });
});
