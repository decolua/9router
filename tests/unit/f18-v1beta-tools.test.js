/**
 * F18 (T1.2 M10) — /v1beta must DELEGATE Gemini translation to the translator
 * engine instead of reimplementing it in the route, and the Gemini JSON branch
 * of sseToJsonHandler must stop discarding already-extracted tool calls.
 *
 * Part A: POST /v1beta/models/{model}:generateContent with tools +
 *   functionCall/functionResponse + inlineData → the internal (OpenAI-shape)
 *   body handed to handleChat must carry tools / tool_calls / role:"tool" /
 *   image_url parts. RED today: convertGeminiToInternal only reads parts[].text.
 *
 * Part B: handleForcedSSEToJson, Responses-API upstream emitting a function_call
 *   item, Gemini-family client → candidates[].content.parts must include
 *   {functionCall:{name,args}}. RED today: the branch hardcodes parts=[{text}]
 *   and finishReason:"STOP", dropping toolCalls extracted 2 lines earlier.
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
const { handleForcedSSEToJson } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");
const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { DEFAULT_MIN_TOKENS } = await import("../../open-sse/config/runtimeConfig.js");

// ---------------------------------------------------------------------------
// Part A — route request translation (gemini → internal OpenAI shape)
// ---------------------------------------------------------------------------

const GEMINI_AGENTIC_BODY = {
  systemInstruction: { parts: [{ text: "Be brief." }] },
  contents: [
    {
      role: "user",
      parts: [
        { text: "Weather in Porto?" },
        { inlineData: { mimeType: "image/png", data: "aGVsbG8=" } },
      ],
    },
    {
      role: "model",
      parts: [{ functionCall: { name: "get_weather", args: { city: "Porto" } } }],
    },
    {
      role: "user",
      parts: [{ functionResponse: { name: "get_weather", response: { result: { temp: 14 } } } }],
    },
  ],
  tools: [
    {
      functionDeclarations: [
        {
          name: "get_weather",
          description: "Fetch weather",
          parameters: { type: "object", properties: { city: { type: "string" } } },
        },
      ],
    },
  ],
  generationConfig: { maxOutputTokens: 128, temperature: 0.3, topP: 0.9 },
};

function openAIJsonResponse() {
  return Response.json({
    id: "chatcmpl-f18",
    object: "chat.completion",
    created: 1700000000,
    model: "f18-model",
    choices: [{ index: 0, message: { role: "assistant", content: "14C" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
  });
}

async function postGemini(body = GEMINI_AGENTIC_BODY) {
  const request = new Request("http://router.test/v1beta/models/f18-model:generateContent", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer client-key" },
    body: JSON.stringify(body),
  });
  const response = await POST(request, {
    params: Promise.resolve({ path: ["f18-model:generateContent"] }),
  });
  return { response, internalBody: await mocks.handleChat.mock.calls[0][0].json() };
}

describe("F18 Part A — /v1beta route delegates gemini→openai to the translator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireApiKey: false });
    mocks.handleChat.mockImplementation(async () => openAIJsonResponse());
  });

  it("carries tools (functionDeclarations → openai tools) into the internal body", async () => {
    const { internalBody } = await postGemini();
    expect(Array.isArray(internalBody.tools)).toBe(true);
    expect(internalBody.tools[0]).toMatchObject({
      type: "function",
      function: { name: "get_weather", description: "Fetch weather" },
    });
    expect(internalBody.tools[0].function.parameters.properties.city.type).toBe("string");
  });

  it("converts model functionCall parts into assistant tool_calls", async () => {
    const { internalBody } = await postGemini();
    const assistant = internalBody.messages.find(
      (m) => m.role === "assistant" && Array.isArray(m.tool_calls)
    );
    expect(assistant).toBeTruthy();
    expect(assistant.tool_calls[0]).toMatchObject({
      type: "function",
      function: { name: "get_weather", arguments: JSON.stringify({ city: "Porto" }) },
    });
  });

  it("converts functionResponse parts into a role:tool message paired by tool_call_id", async () => {
    const { internalBody } = await postGemini();
    const toolMsg = internalBody.messages.find((m) => m.role === "tool");
    expect(toolMsg).toBeTruthy();
    expect(toolMsg.tool_call_id).toBeTruthy();
    expect(JSON.parse(toolMsg.content)).toEqual({ temp: 14 });
  });

  it("keeps inlineData as an image_url part instead of losing the media", async () => {
    const { internalBody } = await postGemini();
    const user = internalBody.messages.find(
      (m) => Array.isArray(m.content) && m.content.some((p) => p.type === "image_url")
    );
    expect(user).toBeTruthy();
    expect(user.content.find((p) => p.type === "image_url").image_url.url).toBe(
      "data:image/png;base64,aGVsbG8="
    );
  });

  it("regression guard: system instruction + generationConfig still map", async () => {
    const { internalBody } = await postGemini();
    expect(internalBody.model).toBe("f18-model");
    expect(internalBody.stream).toBe(false);
    expect(internalBody.messages.find((m) => m.role === "system").content).toBe("Be brief.");
    // canonical translator policy (adjustMaxTokens): tool requests are floored
    // to DEFAULT_MIN_TOKENS to prevent truncated args — the old inline route
    // copy had no such floor.
    expect(internalBody.max_tokens).toBe(DEFAULT_MIN_TOKENS);
    expect(internalBody.temperature).toBe(0.3);
    expect(internalBody.top_p).toBe(0.9);
  });

  it("passes maxOutputTokens through for tool-less requests", async () => {
    const plain = structuredClone(GEMINI_AGENTIC_BODY);
    delete plain.tools;
    plain.contents = [{ role: "user", parts: [{ text: "hi" }] }];
    const { internalBody } = await postGemini(plain);
    expect(internalBody.max_tokens).toBe(128);
  });
});

// ---------------------------------------------------------------------------
// Part B — sseToJsonHandler Gemini-family JSON branch keeps functionCalls
// ---------------------------------------------------------------------------

function responsesSseWithToolCall() {
  const events = [
    'event: response.created\ndata: {"response":{"id":"resp_f18"}}\n\n',
    'event: response.output_item.done\ndata: {"output_index":0,"item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"get_weather","arguments":"{\\"city\\":\\"Porto\\"}"}}\n\n',
    'event: response.output_item.done\ndata: {"output_index":1,"item":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Checking weather"}]}}\n\n',
    'event: response.completed\ndata: {"response":{"usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15}}}\n\n',
  ].join("");
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

function forcedJsonCtx(sourceFormat) {
  return {
    providerResponse: responsesSseWithToolCall(),
    sourceFormat,
    targetFormat: FORMATS.OPENAI_RESPONSES,
    provider: "codex",
    model: "gpt-x",
    body: { model: "gpt-x", messages: [] },
    stream: false,
    requestStartTime: Date.now(),
    connectionId: "test-connection",
    clientRawRequest: { endpoint: "/v1/chat/completions" },
    trackDone: vi.fn(),
    appendLog: vi.fn(),
  };
}

describe("F18 Part B — sseToJsonHandler gemini branch includes functionCalls", () => {
  it("emits functionCall parts (not text-only) for a gemini client with tool calls", async () => {
    const result = await handleForcedSSEToJson(forcedJsonCtx(FORMATS.GEMINI));
    expect(result.success).toBe(true);
    const json = await result.response.json();
    const payload = json.response || json;
    const parts = payload.candidates[0].content.parts;
    const fc = parts.find((p) => p.functionCall);
    expect(fc).toBeTruthy();
    expect(fc.functionCall.name).toBe("get_weather");
    expect(fc.functionCall.args).toEqual({ city: "Porto" });
    // text must survive alongside the call
    expect(parts.some((p) => p.text === "Checking weather")).toBe(true);
    expect(payload.candidates[0].content.role).toBe("model");
    expect(payload.candidates[0].finishReason).toBe("STOP");
  });

  it("keeps the {response: …} envelope for gemini-cli clients", async () => {
    const result = await handleForcedSSEToJson(forcedJsonCtx(FORMATS.GEMINI_CLI));
    const json = await result.response.json();
    expect(json.response).toBeTruthy();
    const parts = json.response.candidates[0].content.parts;
    expect(parts.some((p) => p.functionCall?.name === "get_weather")).toBe(true);
    expect(json.response.usageMetadata).toMatchObject({
      promptTokenCount: 10,
      candidatesTokenCount: 5,
      totalTokenCount: 15,
    });
    expect(json.response.modelVersion).toBe("gpt-x");
  });

  it("keeps antigravity clients working on the same branch", async () => {
    const result = await handleForcedSSEToJson(forcedJsonCtx(FORMATS.ANTIGRAVITY));
    expect(result.success).toBe(true);
    const json = await result.response.json();
    const payload = json.response || json;
    expect(payload.candidates[0].content.parts.some((p) => p.functionCall)).toBe(true);
  });

  it("regression guard: chat clients still get tool_calls on the message", async () => {
    const result = await handleForcedSSEToJson(forcedJsonCtx(FORMATS.OPENAI));
    const json = await result.response.json();
    expect(json.object).toBe("chat.completion");
    expect(json.choices[0].message.tool_calls[0].function.name).toBe("get_weather");
    expect(json.choices[0].finish_reason).toBe("tool_calls");
  });
});
