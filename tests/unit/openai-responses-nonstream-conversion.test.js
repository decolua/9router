import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {})
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { translateNonStreamingResponse, handleNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");

// Upstream Responses API JSON body (object:"response") as returned by
// opencode /zen/v1/responses with stream:false.
// translateNonStreamingResponse arg order: (body, targetFormat=UPSTREAM, sourceFormat=CLIENT).
const RESPONSES_JSON = {
  id: "resp_abc",
  object: "response",
  created_at: 1700000000,
  status: "completed",
  model: "muse-spark-1.2-contributor",
  output: [
    { type: "reasoning", id: "rs_1", summary: [{ type: "summary_text", text: "thinking hard" }] },
    {
      type: "message", id: "msg_1", role: "assistant", status: "completed",
      content: [{ type: "output_text", text: "Hello world", annotations: [] }],
    },
    {
      type: "function_call", id: "fc_1", call_id: "call_1", name: "get_weather",
      arguments: "{\"city\":\"Hanoi\"}", status: "completed",
    },
  ],
  usage: { input_tokens: 12, output_tokens: 34, total_tokens: 46 },
};

describe("Responses upstream JSON → OpenAI Chat client (stream:false)", () => {
  const out = translateNonStreamingResponse(RESPONSES_JSON, FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI);

  it("produces a chat.completion body, never a raw object:response leak", () => {
    expect(out.object).toBe("chat.completion");
    expect(out.object).not.toBe("response");
    expect(Array.isArray(out.choices)).toBe(true);
  });

  it("maps output_text to message content", () => {
    expect(out.choices[0].message.content).toBe("Hello world");
  });

  it("maps reasoning summary to reasoning_content", () => {
    expect(out.choices[0].message.reasoning_content).toBe("thinking hard");
  });

  it("maps function_call to tool_calls", () => {
    const tc = out.choices[0].message.tool_calls?.[0];
    expect(tc).toBeTruthy();
    expect(tc.id).toBe("call_1");
    expect(tc.type).toBe("function");
    expect(tc.function.name).toBe("get_weather");
    expect(tc.function.arguments).toBe("{\"city\":\"Hanoi\"}");
  });

  it("finish_reason is tool_calls when function calls present", () => {
    expect(out.choices[0].finish_reason).toBe("tool_calls");
  });

  it("maps Responses usage to Chat usage", () => {
    expect(out.usage).toMatchObject({ prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 });
  });
});

describe("Responses upstream JSON → Claude client (stream:false)", () => {
  const out = translateNonStreamingResponse(RESPONSES_JSON, FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE);

  it("produces a Claude message body, never a raw object:response leak", () => {
    expect(out.type).toBe("message");
    expect(out.object).toBeUndefined();
    expect(out.role).toBe("assistant");
  });

  it("maps reasoning → thinking block and output_text → text block", () => {
    expect(out.content[0]).toEqual({ type: "thinking", thinking: "thinking hard" });
    expect(out.content[1]).toEqual({ type: "text", text: "Hello world" });
  });

  it("maps function_call → tool_use block", () => {
    const tu = out.content.find((b) => b.type === "tool_use");
    expect(tu).toBeTruthy();
    expect(tu.id).toBe("call_1");
    expect(tu.name).toBe("get_weather");
    expect(tu.input).toEqual({ city: "Hanoi" });
  });

  it("stop_reason is tool_use when function calls present; usage mapped", () => {
    expect(out.stop_reason).toBe("tool_use");
    expect(out.usage).toEqual({ input_tokens: 12, output_tokens: 34 });
  });
});

describe("Responses upstream JSON edge cases", () => {
  it("text-only response finishes stop / end_turn", () => {
    const textOnly = {
      ...RESPONSES_JSON,
      output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "hi", annotations: [] }] }],
    };
    const chat = translateNonStreamingResponse(textOnly, FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI);
    expect(chat.choices[0].finish_reason).toBe("stop");
    const claude = translateNonStreamingResponse(textOnly, FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE);
    expect(claude.stop_reason).toBe("end_turn");
  });

  it("incomplete status maps to length finish (max tokens hit)", () => {
    const truncated = { ...RESPONSES_JSON, status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] };
    const chat = translateNonStreamingResponse(truncated, FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI);
    expect(chat.choices[0].finish_reason).toBe("length");
    const claude = translateNonStreamingResponse(truncated, FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE);
    expect(claude.stop_reason).toBe("max_tokens");
  });

  it("Responses client source==target stays untouched", () => {
    const out = translateNonStreamingResponse(RESPONSES_JSON, FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI_RESPONSES);
    expect(out).toBe(RESPONSES_JSON);
  });
});

describe("Responses upstream answers SSE despite stream:false (fallback)", () => {
  const encoder = new TextEncoder();
  const sseResponse = () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(
        'event: response.output_item.done\n' +
        'data: {"output_index":0,"item":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"from sse","annotations":[]}]}}\n\n' +
        'event: response.completed\n' +
        'data: {"response":{"id":"resp_sse","usage":{"input_tokens":3,"output_tokens":7,"total_tokens":10}}}\n\n'
      ));
      controller.close();
    }
  }), { status: 200, headers: { "content-type": "text/event-stream" } });

  // Production call shape from chatCore: targetFormat = providerResponseFormat
  // (what the UPSTREAM spoke — openai-responses here), sourceFormat = CLIENT format.
  const baseCtx = (clientFormat) => ({
    providerResponse: sseResponse(),
    provider: "opencode",
    model: "muse-spark-1.2-contributor-free",
    sourceFormat: clientFormat,
    targetFormat: FORMATS.OPENAI_RESPONSES,
    body: { model: "muse-spark-1.2-contributor-free", stream: false, messages: [{ role: "user", content: "hi" }] },
    stream: false,
    translatedBody: { model: "muse-spark-1.2-contributor-free", input: [], stream: false },
    finalBody: null,
    requestStartTime: Date.now(),
    connectionId: "test-conn",
    apiKey: null,
    clientRawRequest: { endpoint: "/v1/chat/completions" },
    reqLogger: { logTargetRequest: vi.fn(), logError: vi.fn(), logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
    toolNameMap: null,
    customToolNames: null,
    trackDone: vi.fn(),
    appendLog: vi.fn(),
    reqTag: "",
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), line: vi.fn() },
  });

  it("Chat client gets chat.completion built from Responses SSE events", async () => {
    const result = await handleNonStreamingResponse(baseCtx(FORMATS.OPENAI));
    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.object).toBe("chat.completion");
    expect(json.choices[0].message.content).toBe("from sse");
  });

  it("Claude client gets a Claude message body from Responses SSE events", async () => {
    const result = await handleNonStreamingResponse(baseCtx(FORMATS.CLAUDE));
    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.type).toBe("message");
    expect(json.content.some((b) => b.type === "text" && b.text === "from sse")).toBe(true);
  });
});
