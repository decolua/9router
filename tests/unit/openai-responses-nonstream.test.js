import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {})
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { translateNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");
const { handleForcedSSEToJson } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");
const { openaiResponsesToOpenAIRequest } = await import("../../open-sse/translator/request/openai-responses.js");

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

  it("leaves chat->chat untouched", () => {
    const out = translateNonStreamingResponse(CHAT_TOOL_BODY, FORMATS.OPENAI, FORMATS.OPENAI);
    expect(out.object).toBe("chat.completion");
    expect(out.choices[0].message.tool_calls[0].function.name).toBe("shell");
  });
});

// Regression guard for the custom-tool metadata type mismatch.
//
// The Responses request translator collects custom tool names in a Set but
// exports them as an Array — `result._customToolNames = [...customToolNames]`
// (open-sse/translator/request/openai-responses.js:229). chatCore.js:192 lifts
// that value off the translated body and hands it to this consumer unchanged,
// which asked it for `customToolNames?.has(name)`
// (open-sse/handlers/chatCore/nonStreamingHandler.js:109). Arrays have no
// `.has`, so a custom tool call threw *after* the provider had already answered
// and surfaced to the client as a bodyless HTTP 500.
//
// The streaming path was never affected: open-sse/utils/stream.js:62 already
// normalises with `new Set(customToolNames || [])`. Every pre-existing test in
// this file passed a hand-built Set, so the seam between the producer and this
// consumer was never exercised.
describe("custom tool names supplied as the request translator's array", () => {
  const FREEFORM = "FREEFORM-LIVE-OK";
  const MULTILINE = [
    "FREEFORM-BEGIN",
    "{\"json\":\"looking\"}",
    "Free-Tier-Combo",
    "bridge/free-tier",
    "FREEFORM-END"
  ].join("\n");

  const FREEFORM_TOOL = {
    type: "custom",
    name: "bridge_freeform",
    description: "Echoes freeform text.",
    format: { type: "grammar", syntax: "lark", definition: "start: /(.|\\n)+/" }
  };

  const bodyWithCall = (name, argumentsText) => {
    const body = structuredClone(CHAT_TOOL_BODY);
    body.choices[0].message.tool_calls[0] = {
      id: "call_ff",
      type: "function",
      function: { name, arguments: argumentsText }
    };
    return body;
  };

  const translate = (body, customToolNames) =>
    translateNonStreamingResponse(body, FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, customToolNames);

  const customCall = (out) => (out.output || []).find((item) => item.type === "custom_tool_call");
  const functionCall = (out) => (out.output || []).find((item) => item.type === "function_call");

  it("emits custom_tool_call when the marked name arrives in an array", () => {
    const out = translate(bodyWithCall("bridge_freeform", JSON.stringify({ input: FREEFORM })), ["bridge_freeform"]);
    expect(customCall(out)).toMatchObject({
      call_id: "call_ff",
      name: "bridge_freeform",
      input: FREEFORM
    });
    expect(functionCall(out)).toBeUndefined();
  });

  it("unwraps the Chat input parameter without leaking the JSON wrapper", () => {
    const out = translate(bodyWithCall("bridge_freeform", JSON.stringify({ input: FREEFORM })), ["bridge_freeform"]);
    expect(customCall(out).input).toBe(FREEFORM);
    expect(customCall(out).input).not.toBe(JSON.stringify({ input: FREEFORM }));
  });

  it("preserves multi-line raw input verbatim", () => {
    const out = translate(bodyWithCall("bridge_freeform", JSON.stringify({ input: MULTILINE })), ["bridge_freeform"]);
    expect(customCall(out).input).toBe(MULTILINE);
  });

  it("treats an array and a Set identically", () => {
    const body = bodyWithCall("bridge_freeform", JSON.stringify({ input: FREEFORM }));
    expect(translate(body, ["bridge_freeform"])).toEqual(translate(body, new Set(["bridge_freeform"])));
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an empty array", []],
    ["an empty Set", new Set()]
  ])("emits function_call when the collection is %s", (_label, customToolNames) => {
    const out = translate(bodyWithCall("shell", "{\"cmd\":\"ls\"}"), customToolNames);
    expect(functionCall(out)).toMatchObject({
      call_id: "call_ff",
      name: "shell",
      arguments: "{\"cmd\":\"ls\"}"
    });
    expect(customCall(out)).toBeUndefined();
  });

  it("emits function_call when the array holds a different name", () => {
    const out = translate(bodyWithCall("shell", "{\"cmd\":\"ls\"}"), ["bridge_freeform"]);
    expect(functionCall(out)).toMatchObject({ name: "shell", arguments: "{\"cmd\":\"ls\"}" });
    expect(customCall(out)).toBeUndefined();
  });

  it("accepts the collection the request translator actually produces", () => {
    const translated = openaiResponsesToOpenAIRequest("cx/gpt-5.6-sol", {
      input: [
        { type: "additional_tools", role: "developer", tools: [FREEFORM_TOOL] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "go" }] }
      ]
    }, true, null);

    // Pins the producer contract this consumer has to tolerate.
    expect(Array.isArray(translated._customToolNames)).toBe(true);

    const out = translate(bodyWithCall("bridge_freeform", JSON.stringify({ input: FREEFORM })), translated._customToolNames);
    expect(customCall(out)).toMatchObject({ name: "bridge_freeform", input: FREEFORM });
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

  it("returns a custom_tool_call when the marked names arrive as an array", async () => {
    const ctx = sseCtx(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI);
    ctx.customToolNames = ["shell"];
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
});
