import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {})
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { translateNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");
const { handleForcedSSEToJson } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");

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

  it("restores a provider-normalized custom tool name", () => {
    const customBody = structuredClone(CHAT_TOOL_BODY);
    customBody.choices[0].message.tool_calls[0].function = {
      name: "_123tool",
      arguments: "{\"input\":\"return 1;\"}"
    };
    const out = translateNonStreamingResponse(
      customBody,
      FORMATS.OPENAI,
      FORMATS.OPENAI_RESPONSES,
      new Set(["123tool"]),
      new Map([["_123tool", "123tool"]])
    );
    expect(out.output).toContainEqual(expect.objectContaining({
      type: "custom_tool_call",
      name: "123tool",
      input: "return 1;"
    }));
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

  it("leaves chat->chat untouched", () => {
    const out = translateNonStreamingResponse(CHAT_TOOL_BODY, FORMATS.OPENAI, FORMATS.OPENAI);
    expect(out.object).toBe("chat.completion");
    expect(out.choices[0].message.tool_calls[0].function.name).toBe("shell");
  });

  it("projects a Kiro executor Chat body for a Responses client", () => {
    const kiroBody = structuredClone(CHAT_TOOL_BODY);
    kiroBody.choices[0].message.tool_calls[0] = {
      id: "tooluse_kiro_1",
      type: "function",
      function: { name: "exec", arguments: '{"input":"pwd"}' },
    };
    const out = translateNonStreamingResponse(
      kiroBody,
      FORMATS.KIRO,
      FORMATS.OPENAI_RESPONSES,
      ["exec"],
    );

    expect(out.object).toBe("response");
    expect(out).not.toHaveProperty("choices");
    expect(out.output).toContainEqual(expect.objectContaining({
      type: "custom_tool_call",
      call_id: "tooluse_kiro_1",
      name: "exec",
      input: "pwd",
    }));
  });
});

describe("non-stream Claude upstream for a Responses-API client", () => {
  const claudeBody = (block) => ({
    id: "msg_claude_1",
    type: "message",
    role: "assistant",
    model: "claude-opus-5",
    content: [block],
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  });

  it("projects a Claude custom tool_use into Responses custom_tool_call", () => {
    const out = translateNonStreamingResponse(
      claudeBody({
        type: "tool_use",
        id: "toolu_exec_1",
        name: "exec",
        input: { input: "pwd" },
      }),
      FORMATS.CLAUDE,
      FORMATS.OPENAI_RESPONSES,
      new Set(["exec"]),
    );

    expect(out.object).toBe("response");
    expect(out).not.toHaveProperty("choices");
    expect(out.output).toContainEqual(expect.objectContaining({
      type: "custom_tool_call",
      call_id: "toolu_exec_1",
      name: "exec",
      input: "pwd",
    }));
  });

  it("accepts translator metadata in its real array representation", () => {
    const out = translateNonStreamingResponse(
      claudeBody({
        type: "tool_use",
        id: "toolu_exec_array",
        name: "exec",
        input: { input: "pwd" },
      }),
      FORMATS.CLAUDE,
      FORMATS.OPENAI_RESPONSES,
      ["exec"],
    );

    expect(out.output).toContainEqual(expect.objectContaining({
      type: "custom_tool_call",
      name: "exec",
      input: "pwd",
    }));
  });

  it("keeps ordinary Claude tool_use as a Responses function_call", () => {
    const out = translateNonStreamingResponse(
      claudeBody({
        type: "tool_use",
        id: "toolu_shell_1",
        name: "shell",
        input: { command: "pwd" },
      }),
      FORMATS.CLAUDE,
      FORMATS.OPENAI_RESPONSES,
    );

    expect(out.output).toContainEqual(expect.objectContaining({
      type: "function_call",
      call_id: "toolu_shell_1",
      name: "shell",
      arguments: '{"command":"pwd"}',
    }));
  });
});

describe("non-stream Chat canonical response for a Claude client", () => {
  it("projects a Kiro executor Chat body into a Claude message", () => {
    const kiroBody = structuredClone(CHAT_TOOL_BODY);
    kiroBody.model = "claude-sonnet-4.5";
    kiroBody.choices[0].message.tool_calls[0] = {
      id: "tooluse_kiro_claude_1",
      type: "function",
      function: { name: "shell", arguments: '{"command":"pwd"}' },
    };

    const out = translateNonStreamingResponse(
      kiroBody,
      FORMATS.KIRO,
      FORMATS.CLAUDE,
    );

    expect(out.type).toBe("message");
    expect(out).not.toHaveProperty("choices");
    expect(out.stop_reason).toBe("tool_use");
    expect(out.content).toContainEqual({
      type: "tool_use",
      id: "tooluse_kiro_claude_1",
      name: "shell",
      input: { command: "pwd" },
    });
  });

  it("restores a Kiro-normalized tool name before emitting Claude tool_use", () => {
    const kiroBody = structuredClone(CHAT_TOOL_BODY);
    kiroBody.choices[0].message.tool_calls[0] = {
      id: "tooluse_kiro_claude_2",
      type: "function",
      function: { name: "_123tool", arguments: '{"value":1}' },
    };

    const out = translateNonStreamingResponse(
      kiroBody,
      FORMATS.KIRO,
      FORMATS.CLAUDE,
      null,
      new Map([["_123tool", "123tool"]]),
    );

    expect(out.content).toContainEqual(expect.objectContaining({
      type: "tool_use",
      name: "123tool",
      input: { value: 1 },
    }));
  });
});

describe("forced-SSE JSON path for a Responses-API client behind a chat upstream", () => {
  const CHAT_TOOL_SSE = [
    'data: {"id":"chatcmpl-sse","object":"chat.completion.chunk","created":1700000000,"model":"gpt-x","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_9","type":"function","function":{"name":"shell","arguments":""}}]},"finish_reason":null}]}',
    'data: {"id":"chatcmpl-sse","object":"chat.completion.chunk","created":1700000000,"model":"gpt-x","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"cmd\\":\\"pwd\\"}"}}]},"finish_reason":null}]}',
    'data: {"id":"chatcmpl-sse","object":"chat.completion.chunk","created":1700000000,"model":"gpt-x","choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
    "data: [DONE]",
    ""
  ].join("\n\n");
  const sseCtx = (sourceFormat, targetFormat, raw = CHAT_TOOL_SSE) => {
    const encoder = new TextEncoder();
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

  it("restores a normalized tool name on the forced-SSE JSON path", async () => {
    const ctx = sseCtx(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, [
      'data: {"id":"chatcmpl-sse","object":"chat.completion.chunk","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_9","type":"function","function":{"name":"_123tool","arguments":"{\\"input\\":\\"return 1;\\"}"}}]},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-sse","object":"chat.completion.chunk","choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
      "data: [DONE]",
      ""
    ].join("\n\n"));
    ctx.customToolNames = new Set(["123tool"]);
    ctx.toolNameMap = new Map([["_123tool", "123tool"]]);
    const result = await handleForcedSSEToJson(ctx);
    const json = await result.response.json();
    expect(json.output).toContainEqual(expect.objectContaining({
      type: "custom_tool_call",
      name: "123tool",
      input: "return 1;"
    }));
  });

  it("still returns chat.completion for a plain chat client", async () => {
    const result = await handleForcedSSEToJson(sseCtx(FORMATS.OPENAI, FORMATS.OPENAI));
    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.object).toBe("chat.completion");
    expect(json.choices[0].message.tool_calls[0].function.name).toBe("shell");
  });

});
