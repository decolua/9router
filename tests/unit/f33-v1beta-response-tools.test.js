/**
 * F33 (REV-B nit 1) — the /v1beta route's RESPONSE-side inline converters
 * (transformOpenAISSEToGeminiSSE / convertOpenAIResponseToGemini) still
 * discarded delta.tool_calls / message.tool_calls, so streamGenerateContent
 * and generateContent JSON clients never received functionCall parts. F18
 * (558feda4) fixed the sseToJsonHandler path through the canonical
 * openaiToGeminiResponse (response/openai-to-gemini.js, 30995bb5); this is the
 * symmetric pair at the route itself.
 *
 * Byte-compat guards: for pure-text traffic the route's envelope/key order is
 * pinned EXACTLY (no responseId, modelVersion only on the finish frame with
 * usage) so existing clients see zero change. The guards are expected to pass
 * both before and after the fix — only the tool-call tests flip RED→GREEN.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handleChat: vi.fn(),
  getSettings: vi.fn(),
  isValidApiKey: vi.fn(),
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
}));

vi.mock("@/sse/handlers/chat.js", () => ({ handleChat: mocks.handleChat }));
vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  isValidApiKey: mocks.isValidApiKey,
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: mocks.clearAccountError,
}));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings }));
vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

const { POST } = await import("../../src/app/api/v1beta/models/[...path]/route.js");

const GEMINI_BODY = { contents: [{ role: "user", parts: [{ text: "hi" }] }] };

function sseResponse(events) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(events));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } }
  );
}

async function post(action, upstreamResponse) {
  mocks.handleChat.mockResolvedValue(upstreamResponse);
  const request = new Request(`http://router.test/v1beta/models/f33-model${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer client-key" },
    body: JSON.stringify(GEMINI_BODY),
  });
  return POST(request, {
    params: Promise.resolve({ path: [`f33-model${action}`] }),
  });
}

const postStream = (events) => post(":streamGenerateContent", sseResponse(events));
const postJson = (openAiBody) =>
  post(":generateContent", Response.json(openAiBody));

function frames(text) {
  return text
    .split("\r\n\r\n")
    .filter((f) => f.startsWith("data:"))
    .map((f) => JSON.parse(f.slice(5)));
}

// ---------------------------------------------------------------------------
// Streaming — :streamGenerateContent
// ---------------------------------------------------------------------------

const TEXT_SSE =
  'data: {"id":"c1","model":"m1","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"}}]}\n\n' +
  'data: {"id":"c1","model":"m1","choices":[{"index":0,"delta":{"content":" world"}}]}\n\n' +
  'data: {"id":"c1","model":"m1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":7,"total_tokens":12}}\n\n' +
  "data: [DONE]\n\n";

// Pinned legacy envelope: content→index→finishReason, no responseId,
// usageMetadata/modelVersion only on the finish frame carrying usage.
const TEXT_SSE_FRAMES =
  'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hello"}]},"index":0}]}\r\n\r\n' +
  'data: {"candidates":[{"content":{"role":"model","parts":[{"text":" world"}]},"index":0}]}\r\n\r\n' +
  'data: {"candidates":[{"content":{"role":"model","parts":[{"text":""}]},"index":0,"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":7,"totalTokenCount":12},"modelVersion":"m1"}\r\n\r\n';

const TOOL_CALL_SSE =
  'data: {"id":"c1","model":"m1","choices":[{"index":0,"delta":{"role":"assistant","content":"Sure"}}]}\n\n' +
  'data: {"id":"c1","model":"m1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"get_weather","arguments":""}}]}}]}\n\n' +
  'data: {"id":"c1","model":"m1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"city\\":"}}]}}]}\n\n' +
  'data: {"id":"c1","model":"m1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"Porto\\"}"}}]}}]}\n\n' +
  'data: {"id":"c1","model":"m1","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":5,"completion_tokens":7,"total_tokens":12}}\n\n' +
  "data: [DONE]\n\n";

describe("F33 — /v1beta streaming response keeps delta.tool_calls as functionCall parts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireApiKey: false });
  });

  it("byte-compat guard: pure-text stream keeps the legacy frame envelope exactly", async () => {
    const response = await postStream(TEXT_SSE);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(TEXT_SSE_FRAMES);
  });

  it("emits functionCall parts with accumulated args on the finish chunk", async () => {
    const response = await postStream(TOOL_CALL_SSE);
    const list = frames(await response.text());
    // text still streams first
    expect(list[0].candidates[0].content.parts).toEqual([{ text: "Sure" }]);
    const terminal = list[list.length - 1];
    const parts = terminal.candidates[0].content.parts;
    const fc = parts.find((p) => p.functionCall);
    expect(fc).toBeTruthy();
    expect(fc.functionCall.name).toBe("get_weather");
    expect(fc.functionCall.args).toEqual({ city: "Porto" });
    expect(terminal.candidates[0].finishReason).toBe("STOP");
    expect(terminal.usageMetadata).toMatchObject({
      promptTokenCount: 5,
      candidatesTokenCount: 7,
      totalTokenCount: 12,
    });
  });

  it("emits a synthetic terminal frame when the stream ends without finish_reason", async () => {
    const events =
      'data: {"id":"c1","model":"m1","choices":[{"index":0,"delta":{"content":"Sure"}}]}\n\n' +
      'data: {"id":"c1","model":"m1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"lookup","arguments":"{\\"q\\":\\"x\\"}"}}]}}]}\n\n' +
      "data: [DONE]\n\n";
    const list = frames(await (await postStream(events)).text());
    const terminal = list[list.length - 1];
    expect(terminal.candidates[0].finishReason).toBe("STOP");
    const fc = terminal.candidates[0].content.parts.find((p) => p.functionCall);
    expect(fc?.functionCall).toEqual({ name: "lookup", args: { q: "x" } });
  });

  it("guard: stream frames carry no responseId leak", async () => {
    const text = await (await postStream(TOOL_CALL_SSE)).text();
    expect(text).not.toContain("responseId");
  });
});

// ---------------------------------------------------------------------------
// Non-streaming JSON — :generateContent
// ---------------------------------------------------------------------------

const TEXT_JSON_BODY = {
  id: "c1",
  object: "chat.completion",
  created: 1700000000,
  model: "m1",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "Hello" },
      finish_reason: "stop",
    },
  ],
  usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 },
};

// Pinned legacy envelope incl. key order: candidates(content→finishReason→
// index)→modelVersion→usageMetadata.
const TEXT_JSON_GEMINI =
  '{"candidates":[{"content":{"role":"model","parts":[{"text":"Hello"}]},"finishReason":"STOP","index":0}],"modelVersion":"m1","usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":7,"totalTokenCount":12}}';

describe("F33 — /v1beta JSON response keeps message.tool_calls as functionCall parts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireApiKey: false });
  });

  it("byte-compat guard: pure-text JSON keeps the legacy envelope exactly", async () => {
    const response = await postJson(TEXT_JSON_BODY);
    expect(await response.text()).toBe(TEXT_JSON_GEMINI);
  });

  it("maps a single tool_calls message to functionCall parts (args parsed)", async () => {
    const body = structuredClone(TEXT_JSON_BODY);
    const msg = body.choices[0].message;
    msg.content = null;
    body.choices[0].finish_reason = "tool_calls";
    msg.tool_calls = [
      {
        id: "call_1",
        type: "function",
        function: { name: "get_weather", arguments: '{"city":"Porto"}' },
      },
    ];
    const json = await (await postJson(body)).json();
    const parts = json.candidates[0].content.parts;
    const fc = parts.find((p) => p.functionCall);
    expect(fc).toBeTruthy();
    expect(fc.functionCall).toEqual({ name: "get_weather", args: { city: "Porto" } });
    expect(json.candidates[0].finishReason).toBe("STOP");
    expect(json).not.toHaveProperty("responseId");
  });

  it("keeps text alongside multiple parallel tool calls", async () => {
    const body = structuredClone(TEXT_JSON_BODY);
    body.choices[0].message = {
      role: "assistant",
      content: "Two calls:",
      tool_calls: [
        { id: "a", type: "function", function: { name: "one", arguments: "{}" } },
        { id: "b", type: "function", function: { name: "two", arguments: '{"x":1}' } },
      ],
    };
    body.choices[0].finish_reason = "tool_calls";
    const json = await (await postJson(body)).json();
    const parts = json.candidates[0].content.parts;
    expect(parts.some((p) => p.text === "Two calls:")).toBe(true);
    const calls = parts.filter((p) => p.functionCall).map((p) => p.functionCall);
    expect(calls).toContainEqual({ name: "one", args: {} });
    expect(calls).toContainEqual({ name: "two", args: { x: 1 } });
  });
});
