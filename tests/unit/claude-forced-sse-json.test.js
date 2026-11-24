import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {})
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { handleForcedSSEToJson } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");
const { translateNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");

function context(raw, sourceFormat, targetFormat) {
  return {
    providerResponse: new Response(raw, { headers: { "content-type": "text/event-stream" } }),
    provider: targetFormat === FORMATS.OPENAI_RESPONSES ? "codex" : "op-test-chat",
    model: "test-model",
    sourceFormat,
    targetFormat,
    body: { model: "test-model", stream: false, messages: [] },
    stream: false,
    requestStartTime: Date.now(),
    connectionId: "test-connection",
    clientRawRequest: { endpoint: "/v1/messages" },
    trackDone: vi.fn(),
    appendLog: vi.fn()
  };
}

function responsesSSE(output) {
  const event = (type, data) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  return event("response.created", { response: { id: "resp_test", created_at: 1700000000 } })
    + output.map((item, output_index) => event("response.output_item.done", { item, output_index })).join("")
    + event("response.completed", { response: { usage: { input_tokens: 12, output_tokens: 7, total_tokens: 19 } } });
}

const toolItem = { type: "function_call", call_id: "call_test", name: "lookup", arguments: '{"code":"A"}' };

describe("Claude JSON clients behind forced-stream upstreams", () => {
  it.each(["<decision>allow</decision>", "<decision>block</decision>"])("preserves the upstream text verbatim: %s", async (text) => {
    const raw = responsesSSE([{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }]);
    const result = await handleForcedSSEToJson(context(raw, FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES));
    expect(result.success).toBe(true);
    expect(result.response.headers.get("content-type")).toBe("application/json");
    const json = await result.response.json();
    expect(json).toMatchObject({
      type: "message",
      role: "assistant",
      model: "test-model",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 12, output_tokens: 7 }
    });
    expect(json).not.toHaveProperty("choices");
    expect(json.content.filter(block => block.type === "text").map(block => block.text).join("")).toBe(text);
  });

  it("returns Responses function calls as Claude tool_use blocks", async () => {
    const result = await handleForcedSSEToJson(context(responsesSSE([toolItem]), FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES));
    const json = await result.response.json();
    expect(json.content).toEqual([{ type: "tool_use", id: "call_test", name: "lookup", input: { code: "A" } }]);
    expect(json.stop_reason).toBe("tool_use");
  });

  it("returns standard Chat SSE as a Claude message and preserves truncation", async () => {
    const chunks = [
      { id: "chatcmpl_test", model: "test-model", choices: [{ delta: { content: "partial" }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: "length" }], usage: { prompt_tokens: 8, completion_tokens: 2 } }
    ];
    const raw = chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";
    const result = await handleForcedSSEToJson(context(raw, FORMATS.CLAUDE, FORMATS.OPENAI));
    const json = await result.response.json();
    expect(json.content).toEqual([{ type: "text", text: "partial" }]);
    expect(json.stop_reason).toBe("max_tokens");
    expect(json.usage).toEqual({ input_tokens: 8, output_tokens: 2 });
  });

  it("keeps an empty output as empty text rather than inventing a decision", async () => {
    const result = await handleForcedSSEToJson(context(responsesSSE([]), FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES));
    expect((await result.response.json()).content).toEqual([{ type: "text", text: "" }]);
  });

  it.each([FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, FORMATS.GEMINI])("keeps the existing %s client shape", async (sourceFormat) => {
    const raw = responsesSSE([{ type: "message", role: "assistant", content: [{ type: "output_text", text: "hello" }] }]);
    const result = await handleForcedSSEToJson(context(raw, sourceFormat, FORMATS.OPENAI_RESPONSES));
    const json = await result.response.json();
    if (sourceFormat === FORMATS.OPENAI) expect(json.choices[0].message.content).toBe("hello");
    else if (sourceFormat === FORMATS.OPENAI_RESPONSES) expect(json.output[0].content[0].text).toBe("hello");
    else expect(json.response.candidates[0].content.parts[0].text).toBe("hello");
  });

  it("reuses the same conversion for ordinary non-streaming Chat responses", () => {
    const json = translateNonStreamingResponse({
      id: "chatcmpl_test",
      model: "test-model",
      choices: [{ message: { content: "unchanged" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 3, completion_tokens: 1 }
    }, FORMATS.OPENAI, FORMATS.CLAUDE);
    expect(json.content).toEqual([{ type: "text", text: "unchanged" }]);
    expect(json.stop_reason).toBe("end_turn");
  });
});

describe("Responses reasoning behind a forced-stream upstream (#3495)", () => {
  const reasoningItem = { type: "reasoning", summary: [{ type: "summary_text", text: "Check the " }, { type: "summary_text", text: "lookup table." }] };
  const textItem = { type: "message", role: "assistant", content: [{ type: "output_text", text: "Code A." }] };

  it("returns reasoning summaries to a Claude client as a thinking block before the text", async () => {
    const raw = responsesSSE([reasoningItem, textItem]);
    const json = await (await handleForcedSSEToJson(context(raw, FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES))).response.json();
    expect(json.type).toBe("message");
    expect(json.content).toEqual([
      { type: "thinking", thinking: "Check the lookup table." },
      { type: "text", text: "Code A." }
    ]);
    expect(json.stop_reason).toBe("end_turn");
  });

  it("keeps thinking alongside tool_use for a Claude client", async () => {
    const json = await (await handleForcedSSEToJson(context(responsesSSE([reasoningItem, toolItem]), FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES))).response.json();
    expect(json.content.map(block => block.type)).toEqual(["thinking", "tool_use"]);
    expect(json.stop_reason).toBe("tool_use");
  });

  it("follows the non-streaming Chat policy: no reasoning_content next to text", async () => {
    const json = await (await handleForcedSSEToJson(context(responsesSSE([reasoningItem, textItem]), FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES))).response.json();
    expect(json.choices[0].message.content).toBe("Code A.");
    expect(json.choices[0].message).not.toHaveProperty("reasoning_content");
  });

  it("preserves reasoning_content for a Chat client when it is the only output", async () => {
    const json = await (await handleForcedSSEToJson(context(responsesSSE([reasoningItem]), FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES))).response.json();
    expect(json.choices[0].message.reasoning_content).toBe("Check the lookup table.");
  });
});
