import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {})
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { openaiResponsesToOpenAIRequest } = await import("../../open-sse/translator/request/openai-responses.js");
const { translateNonStreamingResponse, handleNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");
const { handleForcedSSEToJson } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");

function customToolMetadata() {
  return openaiResponsesToOpenAIRequest("gpt-x", {
    input: "Run the tool",
    tools: [{ type: "custom", name: "shell", format: { type: "text" } }],
  }, true, null)._customToolNames;
}

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

  it("accepts custom-tool metadata produced by the request translator", () => {
    const out = translateNonStreamingResponse(
      CHAT_TOOL_BODY,
      FORMATS.OPENAI,
      FORMATS.OPENAI_RESPONSES,
      customToolMetadata()
    );
    expect(out.output.find((item) => item.type === "custom_tool_call")).toMatchObject({
      name: "shell",
      call_id: "call_1",
    });
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

  it("preserves a direct Chat refusal as a Responses refusal message", async () => {
    const body = {
      ...CHAT_TOOL_BODY,
      choices: [{
        index: 0,
        message: { role: "assistant", content: null, refusal: "I cannot help with that." },
        finish_reason: "stop",
      }],
    };

    const result = await handleNonStreamingResponse({
      providerResponse: new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }),
      provider: "op-test-chat",
      model: "gpt-x",
      sourceFormat: FORMATS.OPENAI_RESPONSES,
      targetFormat: FORMATS.OPENAI,
      body: { model: "gpt-x", input: "probe" },
      stream: false,
      requestStartTime: Date.now(),
      reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
      trackDone: vi.fn(),
      appendLog: vi.fn(),
    });

    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.status).toBe("completed");
    expect(json.output[0]).toMatchObject({
      type: "message",
      content: [{ type: "refusal", refusal: "I cannot help with that." }],
    });
  });

  it("reports a direct max-token Chat response as incomplete", () => {
    const body = {
      ...CHAT_TOOL_BODY,
      choices: [{
        index: 0,
        message: { role: "assistant", content: null, reasoning_content: "thinking" },
        finish_reason: "length",
      }],
    };

    const out = translateNonStreamingResponse(body, FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES);
    expect(out.status).toBe("incomplete");
    expect(out.incomplete_details).toEqual({ reason: "max_output_tokens" });
    expect(out.output[0].type).toBe("reasoning");
  });

  it.each([null, "unexpected"])("never marks an unsupported direct Chat finish %s as completed", (finishReason) => {
    const body = {
      ...CHAT_TOOL_BODY,
      choices: [{ index: 0, message: { role: "assistant", content: "partial" }, finish_reason: finishReason }],
    };
    const out = translateNonStreamingResponse(body, FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES);
    expect(out.status).toBe("failed");
    expect(out.error?.code).toBe("invalid_finish_reason");
  });

  it("rejects a direct Chat response that stopped after reasoning without an answer", async () => {
    const body = {
      ...CHAT_TOOL_BODY,
      choices: [{
        index: 0,
        message: { role: "assistant", content: null, reasoning_content: "thinking" },
        finish_reason: "stop",
      }],
    };

    const result = await handleNonStreamingResponse({
      providerResponse: new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }),
      provider: "op-test-chat",
      model: "gpt-x",
      sourceFormat: FORMATS.OPENAI_RESPONSES,
      targetFormat: FORMATS.OPENAI,
      body: { model: "gpt-x", input: "probe" },
      stream: false,
      requestStartTime: Date.now(),
      reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
      trackDone: vi.fn(),
      appendLog: vi.fn(),
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
  });

  it("rejects an unexpected Chat SSE body that ended without a finish marker", async () => {
    const raw = [
      `data: ${JSON.stringify({ id: "chatcmpl-unexpected", choices: [{ index: 0, delta: { reasoning_content: "thinking" }, finish_reason: null }] })}`,
      "data: [DONE]",
      "",
    ].join("\n\n");

    const result = await handleNonStreamingResponse({
      providerResponse: new Response(raw, { headers: { "content-type": "text/event-stream" } }),
      provider: "op-test-chat",
      model: "gpt-x",
      sourceFormat: FORMATS.OPENAI_RESPONSES,
      targetFormat: FORMATS.OPENAI,
      body: { model: "gpt-x", input: "probe" },
      stream: false,
      requestStartTime: Date.now(),
      reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
      trackDone: vi.fn(),
      appendLog: vi.fn(),
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
  });

  it.each([
    ["no finish marker", [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: null }]],
    ["no choice", []],
    ["unknown finish reason", [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "unexpected" }]],
  ])("rejects direct Chat JSON with %s", async (_case, choices) => {
    const onRequestSuccess = vi.fn();
    const result = await handleNonStreamingResponse({
      providerResponse: new Response(JSON.stringify({ ...CHAT_TOOL_BODY, choices }), { headers: { "content-type": "application/json" } }),
      provider: "op-test-chat",
      model: "gpt-x",
      sourceFormat: FORMATS.OPENAI_RESPONSES,
      targetFormat: FORMATS.OPENAI,
      body: { model: "gpt-x", input: "probe" },
      stream: false,
      requestStartTime: Date.now(),
      onRequestSuccess,
      reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
      trackDone: vi.fn(),
      appendLog: vi.fn(),
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(onRequestSuccess).not.toHaveBeenCalled();
  });

  it("normalizes a provider's 'other' finish when it returned a valid tool call", async () => {
    const result = await handleNonStreamingResponse({
      providerResponse: new Response(JSON.stringify({
        ...CHAT_TOOL_BODY,
        choices: [{ ...CHAT_TOOL_BODY.choices[0], finish_reason: "other" }],
      }), { headers: { "content-type": "application/json" } }),
      provider: "op-test-chat",
      model: "gpt-x",
      sourceFormat: FORMATS.OPENAI_RESPONSES,
      targetFormat: FORMATS.OPENAI,
      body: { model: "gpt-x", input: "probe" },
      stream: false,
      requestStartTime: Date.now(),
      reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
      trackDone: vi.fn(),
      appendLog: vi.fn(),
    });

    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.status).toBe("completed");
    expect(json.output[0].type).toBe("function_call");
  });

  it("rejects a direct Chat tool call with no call ID", async () => {
    const body = structuredClone(CHAT_TOOL_BODY);
    body.choices[0].message.tool_calls[0].id = "";
    const result = await handleNonStreamingResponse({
      providerResponse: new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }),
      provider: "op-test-chat",
      model: "gpt-x",
      sourceFormat: FORMATS.OPENAI_RESPONSES,
      targetFormat: FORMATS.OPENAI,
      body: { model: "gpt-x", input: "probe" },
      stream: false,
      requestStartTime: Date.now(),
      reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
      trackDone: vi.fn(),
      appendLog: vi.fn(),
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
  });

  it.each([
    ["a valid parallel call plus one missing an ID", null, [
      { id: "call_1", type: "function", function: { name: "shell", arguments: "{}" } },
      { id: "", type: "function", function: { name: "lookup", arguments: "{}" } },
    ]],
    ["assistant text plus a call with a blank name", "answer", [
      { id: "call_bad", type: "function", function: { name: " ", arguments: "{}" } },
    ]],
  ])("rejects direct Chat JSON with %s", async (_case, content, toolCalls) => {
    const body = structuredClone(CHAT_TOOL_BODY);
    body.choices[0].message.content = content;
    body.choices[0].message.tool_calls = toolCalls;
    const result = await handleNonStreamingResponse({
      providerResponse: new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }),
      provider: "op-test-chat",
      model: "gpt-x",
      sourceFormat: FORMATS.OPENAI_RESPONSES,
      targetFormat: FORMATS.OPENAI,
      body: { model: "gpt-x", input: "probe" },
      stream: false,
      requestStartTime: Date.now(),
      reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
      trackDone: vi.fn(),
      appendLog: vi.fn(),
    });

    expect(result.success).toBe(false);
    expect(result.response.status).toBe(502);
    expect(await result.response.json()).not.toHaveProperty("choices");
  });

  it("leaves chat->chat untouched", () => {
    const out = translateNonStreamingResponse(CHAT_TOOL_BODY, FORMATS.OPENAI, FORMATS.OPENAI);
    expect(out.object).toBe("chat.completion");
    expect(out.choices[0].message.tool_calls[0].function.name).toBe("shell");
  });
});

describe("forced-SSE JSON path for a Responses-API client behind a chat upstream", () => {
  const reasoningDone = {
    type: "response.output_item.done",
    output_index: 0,
    item: { type: "reasoning", summary: [{ type: "summary_text", text: "thinking" }] },
  };
  const nativeSSE = (events) => [
    ...events.map((item) => `event: ${item.type}\ndata: ${JSON.stringify(item)}`),
    "data: [DONE]",
    "",
  ].join("\n\n");

  const sseCtx = (sourceFormat, targetFormat, upstreamSSE) => {
    const encoder = new TextEncoder();
    const raw = upstreamSSE ?? [
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

  it("preserves a streamed Chat refusal in forced-SSE JSON conversion", async () => {
    const raw = [
      `data: ${JSON.stringify({ id: "chatcmpl-refusal", choices: [{ index: 0, delta: { refusal: "I cannot " }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ id: "chatcmpl-refusal", choices: [{ index: 0, delta: { refusal: "help with that." }, finish_reason: "stop" }] })}`,
      "data: [DONE]",
      "",
    ].join("\n\n");

    const result = await handleForcedSSEToJson(
      sseCtx(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, raw)
    );
    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.status).toBe("completed");
    expect(json.output[0]).toMatchObject({
      type: "message",
      content: [{ type: "refusal", refusal: "I cannot help with that." }],
    });
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

  it("accepts translated custom-tool metadata on the forced-SSE JSON path", async () => {
    const ctx = sseCtx(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI);
    ctx.customToolNames = customToolMetadata();
    const result = await handleForcedSSEToJson(ctx);
    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.output.find((item) => item.type === "custom_tool_call")).toMatchObject({
      name: "shell",
      call_id: "call_9",
    });
  });

  it("rejects a Chat SSE tool call with no call ID", async () => {
    const raw = [
      `data: ${JSON.stringify({ id: "chatcmpl-no-id", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, type: "function", function: { name: "shell", arguments: "{}" } }] }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ id: "chatcmpl-no-id", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}`,
      "data: [DONE]",
      "",
    ].join("\n\n");
    const result = await handleForcedSSEToJson(sseCtx(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, raw));
    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
  });

  it("rejects a Chat SSE stream with one valid call and one missing a call ID", async () => {
    const raw = [
      `data: ${JSON.stringify({ id: "chatcmpl-mixed", choices: [{ index: 0, delta: { tool_calls: [
        { index: 0, id: "call_good", type: "function", function: { name: "shell", arguments: "{}" } },
        { index: 1, type: "function", function: { name: "lookup", arguments: "{}" } },
      ] }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ id: "chatcmpl-mixed", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}`,
      "data: [DONE]",
      "",
    ].join("\n\n");

    const result = await handleForcedSSEToJson(sseCtx(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, raw));
    expect(result.success).toBe(false);
    expect(result.response.status).toBe(502);
    expect(await result.response.json()).not.toHaveProperty("output");
  });

  it("still returns chat.completion for a plain chat client", async () => {
    const result = await handleForcedSSEToJson(sseCtx(FORMATS.OPENAI, FORMATS.OPENAI));
    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.object).toBe("chat.completion");
    expect(json.choices[0].message.tool_calls[0].function.name).toBe("shell");
  });

  it("rejects a reasoning-only Chat SSE stream with no finish marker", async () => {
    const raw = [
      `data: ${JSON.stringify({ id: "chatcmpl-incomplete", choices: [{ index: 0, delta: { reasoning_content: "thinking" }, finish_reason: null }] })}`,
      "data: [DONE]",
      "",
    ].join("\n\n");

    const result = await handleForcedSSEToJson(sseCtx(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, raw));
    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
  });

  it("rejects a Chat SSE stream that stopped after reasoning without an answer", async () => {
    const raw = [
      `data: ${JSON.stringify({ id: "chatcmpl-empty", choices: [{ index: 0, delta: { reasoning_content: "thinking" }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ id: "chatcmpl-empty", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}`,
      "data: [DONE]",
      "",
    ].join("\n\n");

    const result = await handleForcedSSEToJson(sseCtx(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, raw));
    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
  });

  it("rejects an unsupported Chat SSE finish instead of inventing a completion", async () => {
    const raw = [
      `data: ${JSON.stringify({ id: "chatcmpl-unknown", choices: [{ index: 0, delta: { content: "partial" }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ id: "chatcmpl-unknown", choices: [{ index: 0, delta: {}, finish_reason: "unexpected" }] })}`,
      "data: [DONE]",
      "",
    ].join("\n\n");
    const result = await handleForcedSSEToJson(sseCtx(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, raw));
    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
  });

  it("reports a max-token Chat finish as an incomplete Responses result", async () => {
    const raw = [
      `data: ${JSON.stringify({ id: "chatcmpl-length", choices: [{ index: 0, delta: { reasoning_content: "thinking" }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ id: "chatcmpl-length", choices: [{ index: 0, delta: {}, finish_reason: "length" }] })}`,
      "data: [DONE]",
      "",
    ].join("\n\n");

    const result = await handleForcedSSEToJson(sseCtx(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, raw));
    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.status).toBe("incomplete");
    expect(json.incomplete_details).toEqual({ reason: "max_output_tokens" });
  });

  it("preserves an incomplete terminal from a native Responses upstream", async () => {
    const raw = [
      `event: response.created\ndata: ${JSON.stringify({ type: "response.created", response: { id: "resp_length", status: "in_progress" } })}`,
      `event: response.output_item.done\ndata: ${JSON.stringify({ type: "response.output_item.done", output_index: 0, item: { type: "reasoning", summary: [{ type: "summary_text", text: "thinking" }] } })}`,
      `event: response.incomplete\ndata: ${JSON.stringify({ type: "response.incomplete", response: { id: "resp_length", status: "incomplete", incomplete_details: { reason: "max_output_tokens" } } })}`,
      "data: [DONE]",
      "",
    ].join("\n\n");

    const result = await handleForcedSSEToJson(sseCtx(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI_RESPONSES, raw));
    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.status).toBe("incomplete");
    expect(json.incomplete_details).toEqual({ reason: "max_output_tokens" });
    expect(json.output[0].type).toBe("reasoning");
  });

  it.each([
    ["max_output_tokens", "length"],
    ["content_filter", "content_filter"],
  ])("maps a native Responses %s incomplete result to Chat finish_reason %s", async (reason, finishReason) => {
    const raw = nativeSSE([
      { type: "response.created", response: { id: "resp_incomplete_chat", status: "in_progress" } },
      {
        type: "response.incomplete",
        response: {
          id: "resp_incomplete_chat",
          status: "incomplete",
          incomplete_details: { reason },
          output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "partial answer" }] }],
        },
      },
    ]);

    const result = await handleForcedSSEToJson(sseCtx(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, raw));
    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.choices[0].finish_reason).toBe(finishReason);
    expect(json.choices[0].message.content).toBe("partial answer");
  });

  it("uses canonical output from a native Responses terminal when no item.done event arrived", async () => {
    const raw = nativeSSE([
      { type: "response.created", response: { id: "resp_terminal_output", status: "in_progress" } },
      {
        type: "response.completed",
        response: {
          id: "resp_terminal_output",
          status: "completed",
          output: [{
            id: "msg_answer",
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "answer" }],
          }],
          usage: { input_tokens: 4, output_tokens: 1, total_tokens: 5 },
        },
      },
    ]);

    const result = await handleForcedSSEToJson(
      sseCtx(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI_RESPONSES, raw)
    );
    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.status).toBe("completed");
    expect(json.output[0]).toMatchObject({
      type: "message",
      content: [{ type: "output_text", text: "answer" }],
    });
  });

  it("accepts a native Responses refusal as a completed assistant result", async () => {
    const raw = nativeSSE([
      { type: "response.created", response: { id: "resp_refusal", status: "in_progress" } },
      {
        type: "response.output_item.done",
        output_index: 0,
        item: {
          type: "message",
          role: "assistant",
          content: [{ type: "refusal", refusal: "I cannot help with that." }],
        },
      },
      { type: "response.completed", response: { id: "resp_refusal", status: "completed" } },
    ]);

    const result = await handleForcedSSEToJson(
      sseCtx(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI_RESPONSES, raw)
    );
    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.status).toBe("completed");
    expect(json.output[0].content[0]).toEqual({
      type: "refusal",
      refusal: "I cannot help with that.",
    });
  });

  it("returns a native Responses refusal to a Chat JSON client", async () => {
    const raw = nativeSSE([
      { type: "response.created", response: { id: "resp_chat_refusal", status: "in_progress" } },
      {
        type: "response.completed",
        response: {
          id: "resp_chat_refusal",
          status: "completed",
          output: [{
            type: "message",
            role: "assistant",
            content: [{ type: "refusal", refusal: "I cannot help with that." }],
          }],
        },
      },
    ]);

    const result = await handleForcedSSEToJson(sseCtx(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, raw));
    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.choices[0].message.refusal).toBe("I cannot help with that.");
    expect(json.choices[0].finish_reason).toBe("stop");
  });

  it("returns a native custom tool call to a Chat JSON client", async () => {
    const input = "return await tools.shell({ command: 'pwd' });";
    const raw = nativeSSE([{
      type: "response.completed",
      response: {
        id: "resp_custom_chat",
        status: "completed",
        output: [{ type: "custom_tool_call", call_id: "call_exec", name: "exec", input }],
      },
    }]);

    const result = await handleForcedSSEToJson(
      sseCtx(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, raw)
    );
    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.choices[0].message.tool_calls).toEqual([{
      id: "call_exec",
      type: "function",
      function: { name: "exec", arguments: JSON.stringify({ input }) },
    }]);
    expect(json.choices[0].finish_reason).toBe("tool_calls");
  });

  it("rejects a native Responses stream that closes without a terminal event", async () => {
    const raw = nativeSSE([
      { type: "response.created", response: { id: "resp_cut", status: "in_progress" } },
      reasoningDone,
    ]);
    const ctx = sseCtx(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI_RESPONSES, raw);
    ctx.onRequestSuccess = vi.fn();

    const result = await handleForcedSSEToJson(ctx);
    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(ctx.onRequestSuccess).not.toHaveBeenCalled();
  });

  it("rejects a native Responses completion containing only reasoning", async () => {
    const raw = nativeSSE([
      { type: "response.created", response: { id: "resp_empty", status: "in_progress" } },
      reasoningDone,
      { type: "response.completed", response: { id: "resp_empty", status: "completed", usage: { input_tokens: 1, output_tokens: 10, total_tokens: 11 } } },
    ]);
    const ctx = sseCtx(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI_RESPONSES, raw);
    ctx.onRequestSuccess = vi.fn();

    const result = await handleForcedSSEToJson(ctx);
    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(ctx.onRequestSuccess).not.toHaveBeenCalled();
  });

  it.each([
    ["a valid parallel call plus one missing a call ID", [
      { type: "function_call", call_id: "call_good", name: "shell", arguments: "{}" },
      { type: "function_call", call_id: "", name: "lookup", arguments: "{}" },
    ]],
    ["assistant text plus a call with a blank name", [
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "answer" }] },
      { type: "function_call", call_id: "call_bad", name: " ", arguments: "{}" },
    ]],
  ])("rejects native Responses output with %s", async (_case, output) => {
    const raw = nativeSSE([{
      type: "response.completed",
      response: { id: "resp_mixed", status: "completed", output },
    }]);

    const result = await handleForcedSSEToJson(
      sseCtx(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI_RESPONSES, raw)
    );
    expect(result.success).toBe(false);
    expect(result.response.status).toBe(502);
    expect(await result.response.json()).not.toHaveProperty("output");
  });

  it("surfaces a native Responses failure instead of recording success", async () => {
    const raw = nativeSSE([
      { type: "response.created", response: { id: "resp_failed", status: "in_progress" } },
      { type: "response.failed", response: { id: "resp_failed", status: "failed", error: { type: "server_error", message: "upstream overloaded" } } },
    ]);
    const ctx = sseCtx(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI_RESPONSES, raw);
    ctx.onRequestSuccess = vi.fn();

    const result = await handleForcedSSEToJson(ctx);
    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(result.error).toContain("upstream overloaded");
    expect(ctx.onRequestSuccess).not.toHaveBeenCalled();
  });

  it("honors an incomplete status carried by response.done", async () => {
    const raw = nativeSSE([
      { type: "response.created", response: { id: "resp_done", status: "in_progress" } },
      reasoningDone,
      { type: "response.done", response: { id: "resp_done", status: "incomplete", incomplete_details: { reason: "max_output_tokens" } } },
    ]);

    const result = await handleForcedSSEToJson(sseCtx(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI_RESPONSES, raw));
    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.status).toBe("incomplete");
    expect(json.incomplete_details).toEqual({ reason: "max_output_tokens" });
  });
});
