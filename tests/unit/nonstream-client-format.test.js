// Non-streaming responses must reach the client in the CLIENT's format, whatever
// format the provider speaks: provider body → OpenAI Chat Completions (hub) → client.
// Before the fix only OpenAI-format providers were converted to the client format; a
// Claude client (/v1/messages, stream:false) on a Gemini provider got an OpenAI
// `chat.completion` body, and so did a Responses client (/v1/responses).
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { translateNonStreamingResponse, handleNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");
const { handleForcedSSEToJson } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");

// addBufferToUsage adds this headroom to prompt/input tokens on the plain non-stream path.
const BUFFER = 2000;

// ── Gemini provider bodies (generateContent JSON) ──────────────────────────
const geminiText = (finishReason = "STOP") => ({
  candidates: [{ content: { role: "model", parts: [{ text: "Hello " }, { text: "world" }] }, finishReason, index: 0 }],
  usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 7, totalTokenCount: 18 },
  modelVersion: "gemini-3.8-flash",
  responseId: "gem-1",
});

const geminiToolWithThought = () => ({
  candidates: [{
    content: {
      role: "model",
      parts: [
        { text: "Let me check the weather.", thought: true },
        { text: "Checking." },
        { functionCall: { name: "get_weather", args: { city: "Paris" } } },
      ],
    },
    finishReason: "STOP",
    index: 0,
  }],
  usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 9, thoughtsTokenCount: 4, totalTokenCount: 33 },
  modelVersion: "gemini-3.6-flash",
  responseId: "gem-2",
});

// ── OpenAI / Claude / Ollama provider bodies ───────────────────────────────
const openAIText = () => ({
  id: "chatcmpl-oa1",
  object: "chat.completion",
  created: 1700000000,
  model: "gpt-x",
  choices: [{ index: 0, message: { role: "assistant", content: "hi there", reasoning_content: "thinking..." }, finish_reason: "stop" }],
  usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
});

const claudeTool = () => ({
  id: "msg_c1",
  type: "message",
  role: "assistant",
  model: "claude-x",
  content: [
    { type: "thinking", thinking: "plan" },
    { type: "text", text: "Running it." },
    { type: "tool_use", id: "toolu_1", name: "shell", input: { cmd: "ls" } },
  ],
  stop_reason: "tool_use",
  usage: { input_tokens: 12, output_tokens: 6 },
});

const ollamaText = () => ({
  model: "llama3",
  message: { role: "assistant", content: "from ollama" },
  done: true,
  done_reason: "stop",
  prompt_eval_count: 4,
  eval_count: 2,
});

describe("translateNonStreamingResponse: Claude client", () => {
  it("Gemini provider → Anthropic message (text, usage, end_turn)", () => {
    const out = translateNonStreamingResponse(geminiText(), FORMATS.GEMINI, FORMATS.CLAUDE);
    expect(out.type).toBe("message");
    expect(out.role).toBe("assistant");
    expect(out).not.toHaveProperty("choices");
    expect(out.content).toEqual([{ type: "text", text: "Hello world" }]);
    expect(out.stop_reason).toBe("end_turn");
    expect(out.usage).toEqual({ input_tokens: 11, output_tokens: 7 });
    expect(out.model).toBe("gemini-3.8-flash");
  });

  it("Gemini provider → thought part becomes a thinking block, functionCall a tool_use, stop_reason tool_use", () => {
    const out = translateNonStreamingResponse(geminiToolWithThought(), FORMATS.GEMINI, FORMATS.CLAUDE);
    expect(out.type).toBe("message");
    expect(out.content.map((b) => b.type)).toEqual(["thinking", "text", "tool_use"]);
    expect(out.content[0].thinking).toBe("Let me check the weather.");
    expect(out.content[1].text).toBe("Checking.");
    expect(out.content[2]).toMatchObject({ type: "tool_use", name: "get_weather", input: { city: "Paris" } });
    expect(out.content[2].id).toBeTruthy();
    expect(out.stop_reason).toBe("tool_use");
    // Gemini counts thoughts separately; the hub folds them into the prompt side (unchanged).
    expect(out.usage).toEqual({ input_tokens: 24, output_tokens: 9 });
  });

  it("Gemini MAX_TOKENS → stop_reason max_tokens", () => {
    const out = translateNonStreamingResponse(geminiText("MAX_TOKENS"), FORMATS.GEMINI, FORMATS.CLAUDE);
    expect(out.stop_reason).toBe("max_tokens");
  });

  it("Gemini SAFETY → stop_reason refusal", () => {
    const out = translateNonStreamingResponse(geminiText("SAFETY"), FORMATS.GEMINI, FORMATS.CLAUDE);
    expect(out.stop_reason).toBe("refusal");
  });

  for (const fmt of ["ANTIGRAVITY", "GEMINI_CLI"]) {
    it(`${fmt} provider ({response:{…}} envelope) → Anthropic message`, () => {
      const out = translateNonStreamingResponse({ response: geminiText() }, FORMATS[fmt], FORMATS.CLAUDE);
      expect(out.type).toBe("message");
      expect(out.content[0].text).toBe("Hello world");
    });
  }

  it("Vertex provider → Anthropic message", () => {
    const out = translateNonStreamingResponse(geminiText(), FORMATS.VERTEX, FORMATS.CLAUDE);
    expect(out.type).toBe("message");
  });

  it("OpenAI provider → Anthropic message (unchanged behaviour)", () => {
    const out = translateNonStreamingResponse(openAIText(), FORMATS.OPENAI, FORMATS.CLAUDE);
    expect(out.type).toBe("message");
    expect(out.id).toBe("oa1");
    expect(out.content).toEqual([{ type: "thinking", thinking: "thinking..." }, { type: "text", text: "hi there" }]);
    expect(out.stop_reason).toBe("end_turn");
    expect(out.usage).toEqual({ input_tokens: 5, output_tokens: 3 });
  });

  it("Ollama provider → Anthropic message", () => {
    const out = translateNonStreamingResponse(ollamaText(), FORMATS.OLLAMA, FORMATS.CLAUDE);
    expect(out.type).toBe("message");
    expect(out.content).toEqual([{ type: "text", text: "from ollama" }]);
    expect(out.usage).toEqual({ input_tokens: 4, output_tokens: 2 });
  });

  it("an executor that already decodes to Chat Completions (non-standard format id) → Anthropic message", () => {
    const out = translateNonStreamingResponse(openAIText(), "grok-web", FORMATS.CLAUDE);
    expect(out.type).toBe("message");
    expect(out.content[1].text).toBe("hi there");
  });

  it("Claude provider + Claude client is passed through untouched", () => {
    const body = claudeTool();
    expect(translateNonStreamingResponse(body, FORMATS.CLAUDE, FORMATS.CLAUDE)).toBe(body);
  });
});

describe("translateNonStreamingResponse: Responses client", () => {
  it("Gemini provider → Responses object (message item, usage)", () => {
    const out = translateNonStreamingResponse(geminiText(), FORMATS.GEMINI, FORMATS.OPENAI_RESPONSES);
    expect(out.object).toBe("response");
    expect(out).not.toHaveProperty("choices");
    expect(out.status).toBe("completed");
    expect(out.output).toEqual([
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "Hello world", annotations: [] }] },
    ]);
    expect(out.usage).toMatchObject({ input_tokens: 11, output_tokens: 7, total_tokens: 18 });
  });

  it("Gemini provider → reasoning item + message item + function_call item", () => {
    const out = translateNonStreamingResponse(geminiToolWithThought(), FORMATS.GEMINI, FORMATS.OPENAI_RESPONSES);
    expect(out.object).toBe("response");
    expect(out.output.map((o) => o.type)).toEqual(["reasoning", "message", "function_call"]);
    expect(out.output[0].summary[0].text).toBe("Let me check the weather.");
    const fc = out.output[2];
    expect(fc.name).toBe("get_weather");
    expect(JSON.parse(fc.arguments)).toEqual({ city: "Paris" });
    expect(fc.call_id).toBeTruthy();
    expect(out.status).toBe("completed");
  });

  it("Gemini provider → marked custom tool becomes a custom_tool_call", () => {
    const body = geminiToolWithThought();
    body.candidates[0].content.parts[2] = { functionCall: { name: "exec", args: { input: "pwd" } } };
    const out = translateNonStreamingResponse(body, FORMATS.GEMINI, FORMATS.OPENAI_RESPONSES, new Set(["exec"]));
    expect(out.output.find((o) => o.type === "custom_tool_call")).toMatchObject({ name: "exec", input: "pwd" });
  });

  it("Claude provider → Responses object (was: OpenAI chat.completion)", () => {
    const out = translateNonStreamingResponse(claudeTool(), FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES);
    expect(out.object).toBe("response");
    expect(out.output.map((o) => o.type)).toEqual(["reasoning", "message", "function_call"]);
    expect(out.output[2]).toMatchObject({ call_id: "toolu_1", name: "shell", arguments: "{\"cmd\":\"ls\"}" });
    expect(out.usage).toMatchObject({ input_tokens: 12, output_tokens: 6 });
  });

  it("OpenAI provider → Responses object (unchanged behaviour)", () => {
    const out = translateNonStreamingResponse(openAIText(), FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES);
    expect(out.object).toBe("response");
    expect(out.output.find((o) => o.type === "message").content[0].text).toBe("hi there");
  });
});

describe("translateNonStreamingResponse: OpenAI client (unchanged behaviour)", () => {
  it("Gemini provider → chat.completion with text and usage", () => {
    const out = translateNonStreamingResponse(geminiText(), FORMATS.GEMINI, FORMATS.OPENAI);
    expect(out.object).toBe("chat.completion");
    expect(out.choices[0].message).toEqual({ role: "assistant", content: "Hello world" });
    expect(out.choices[0].finish_reason).toBe("stop");
    expect(out.usage).toEqual({ prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 });
  });

  it("Gemini provider → chat.completion with tool_calls, reasoning_content and reasoning usage", () => {
    const out = translateNonStreamingResponse(geminiToolWithThought(), FORMATS.GEMINI, FORMATS.OPENAI);
    const msg = out.choices[0].message;
    expect(msg.content).toBe("Checking.");
    expect(msg.reasoning_content).toBe("Let me check the weather.");
    expect(msg.tool_calls[0].function).toEqual({ name: "get_weather", arguments: "{\"city\":\"Paris\"}" });
    expect(out.choices[0].finish_reason).toBe("tool_calls");
    expect(out.usage).toEqual({ prompt_tokens: 24, completion_tokens: 9, total_tokens: 33, completion_tokens_details: { reasoning_tokens: 4 } });
  });

  it("Gemini MAX_TOKENS → finish_reason length (same mapping as the streaming translator)", () => {
    const out = translateNonStreamingResponse(geminiText("MAX_TOKENS"), FORMATS.GEMINI, FORMATS.OPENAI);
    expect(out.choices[0].finish_reason).toBe("length");
  });

  it("Claude provider → chat.completion", () => {
    const out = translateNonStreamingResponse(claudeTool(), FORMATS.CLAUDE, FORMATS.OPENAI);
    expect(out.object).toBe("chat.completion");
    expect(out.choices[0].finish_reason).toBe("tool_calls");
    expect(out.choices[0].message.tool_calls[0].function.name).toBe("shell");
  });

  it("Claude-target provider that answered in OpenAI shape is returned as-is", () => {
    const body = openAIText();
    expect(translateNonStreamingResponse(body, FORMATS.CLAUDE, FORMATS.OPENAI)).toBe(body);
  });
});

// ── Full handler: usage buffer/filter, finish fix-up, isClaudeMessage / isResponses ──
function jsonProviderResponse(obj) {
  return new Response(JSON.stringify(obj), { status: 200, headers: { "content-type": "application/json" } });
}

function callHandler({ providerResponse, sourceFormat, targetFormat, customToolNames = null }) {
  return handleNonStreamingResponse({
    providerResponse,
    provider: "gemini",
    model: "gemini-3.8-flash",
    sourceFormat,
    targetFormat,
    body: { stream: false },
    stream: false,
    translatedBody: null,
    finalBody: null,
    requestStartTime: Date.now(),
    connectionId: "c1",
    apiKey: "k",
    clientRawRequest: null,
    onRequestSuccess: null,
    reqLogger: { logProviderResponse() {}, logConvertedResponse() {} },
    toolNameMap: null,
    customToolNames,
    trackDone: () => {},
    appendLog: () => {},
    pxpipe: null,
    reqTag: "t",
    log: null,
  });
}

describe("handleNonStreamingResponse returns the client's format", () => {
  it("Claude client ← Gemini provider: Anthropic message, Claude usage fields only", async () => {
    const result = await callHandler({ providerResponse: jsonProviderResponse(geminiToolWithThought()), sourceFormat: FORMATS.CLAUDE, targetFormat: FORMATS.GEMINI });
    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.type).toBe("message");
    expect(json).not.toHaveProperty("object");
    expect(json).not.toHaveProperty("created");
    expect(json).not.toHaveProperty("choices");
    expect(json.stop_reason).toBe("tool_use");
    expect(json.content.map((b) => b.type)).toEqual(["thinking", "text", "tool_use"]);
    expect(json.usage).toEqual({ input_tokens: 24 + BUFFER, output_tokens: 9 });
  });

  it("Responses client ← Gemini provider: Responses object with Responses usage", async () => {
    const result = await callHandler({ providerResponse: jsonProviderResponse(geminiText()), sourceFormat: FORMATS.OPENAI_RESPONSES, targetFormat: FORMATS.GEMINI });
    const json = await result.response.json();
    expect(json.object).toBe("response");
    expect(json).not.toHaveProperty("choices");
    expect(json.output[0].content[0].text).toBe("Hello world");
    expect(json.usage).toEqual({ input_tokens: 11 + BUFFER, output_tokens: 7 });
  });

  it("OpenAI client ← Gemini provider: chat.completion (unchanged behaviour)", async () => {
    const result = await callHandler({ providerResponse: jsonProviderResponse(geminiText()), sourceFormat: FORMATS.OPENAI, targetFormat: FORMATS.GEMINI });
    const json = await result.response.json();
    expect(json.object).toBe("chat.completion");
    expect(json.choices[0].message.content).toBe("Hello world");
    expect(json.usage).toEqual({ prompt_tokens: 11 + BUFFER, completion_tokens: 7, total_tokens: 18 + BUFFER });
  });

  it("Claude client ← OpenAI provider: Anthropic message (unchanged behaviour)", async () => {
    const result = await callHandler({ providerResponse: jsonProviderResponse(openAIText()), sourceFormat: FORMATS.CLAUDE, targetFormat: FORMATS.OPENAI });
    const json = await result.response.json();
    expect(json.type).toBe("message");
    expect(json.content[1]).toEqual({ type: "text", text: "hi there" });
    expect(json.usage).toEqual({ input_tokens: 5 + BUFFER, output_tokens: 3 });
  });

  it("a non-standard finish_reason with tool_calls is fixed before the client conversion (stop_reason tool_use)", async () => {
    const body = openAIText();
    body.choices[0].message = { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "shell", arguments: "{}" } }] };
    body.choices[0].finish_reason = "other";
    const result = await callHandler({ providerResponse: jsonProviderResponse(body), sourceFormat: FORMATS.CLAUDE, targetFormat: FORMATS.OPENAI });
    const json = await result.response.json();
    expect(json.stop_reason).toBe("tool_use");
    expect(json.content).toEqual([{ type: "tool_use", id: "call_1", name: "shell", input: {} }]);
  });

  it("Claude client ← SSE body on a non-stream request (parsed to the hub first): Anthropic message", async () => {
    const sse = [
      'data: {"id":"chatcmpl-s","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"content":"from sse"}}]}',
      'data: {"id":"chatcmpl-s","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":2,"total_tokens":4}}',
      "data: [DONE]",
      "",
    ].join("\n\n");
    const providerResponse = new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
    const result = await callHandler({ providerResponse, sourceFormat: FORMATS.CLAUDE, targetFormat: FORMATS.GEMINI });
    const json = await result.response.json();
    expect(json.type).toBe("message");
    expect(json.content).toEqual([{ type: "text", text: "from sse" }]);
    expect(json.stop_reason).toBe("end_turn");
  });
});

// ── Forced-SSE → JSON (provider always streams, client asked for JSON) ──────
function sseResponse(lines, contentType = "text/event-stream") {
  const raw = lines.join("\n\n") + "\n\n";
  return new Response(raw, { status: 200, headers: { "content-type": contentType } });
}

const CHAT_SSE = [
  'data: {"id":"chatcmpl-f1","object":"chat.completion.chunk","created":1700000000,"model":"gpt-x","choices":[{"index":0,"delta":{"content":"Sure."}}]}',
  'data: {"id":"chatcmpl-f1","object":"chat.completion.chunk","created":1700000000,"model":"gpt-x","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_7","type":"function","function":{"name":"shell","arguments":"{\\"cmd\\":"}}]}}]}',
  'data: {"id":"chatcmpl-f1","object":"chat.completion.chunk","created":1700000000,"model":"gpt-x","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"pwd\\"}"}}]}}]}',
  'data: {"id":"chatcmpl-f1","object":"chat.completion.chunk","created":1700000000,"model":"gpt-x","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":9,"completion_tokens":4,"total_tokens":13}}',
  "data: [DONE]",
];

const RESPONSES_SSE = [
  'event: response.created\ndata: {"type":"response.created","response":{"id":"resp_x","object":"response","status":"in_progress","model":"gpt-5","output":[]}}',
  'event: response.output_item.done\ndata: {"type":"response.output_item.done","output_index":0,"item":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"codex says hi"}]}}',
  'event: response.output_item.done\ndata: {"type":"response.output_item.done","output_index":1,"item":{"type":"function_call","call_id":"call_c1","name":"shell","arguments":"{\\"cmd\\":\\"ls\\"}"}}',
  'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_x","object":"response","status":"completed","model":"gpt-5","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"codex says hi"}]},{"type":"function_call","call_id":"call_c1","name":"shell","arguments":"{\\"cmd\\":\\"ls\\"}"}],"usage":{"input_tokens":10,"output_tokens":5}}}',
];

function forcedCtx({ providerResponse, sourceFormat, targetFormat, provider }) {
  return {
    providerResponse, sourceFormat, targetFormat, provider,
    model: "m", body: { stream: false }, stream: false,
    requestStartTime: Date.now(), connectionId: "c1",
    clientRawRequest: { endpoint: "/v1/messages" },
    trackDone: vi.fn(), appendLog: vi.fn(),
  };
}

describe("handleForcedSSEToJson returns the client's format", () => {
  it("Claude client ← chat SSE (forced-streaming OpenAI-format provider): Anthropic message", async () => {
    const result = await handleForcedSSEToJson(forcedCtx({ providerResponse: sseResponse(CHAT_SSE), sourceFormat: FORMATS.CLAUDE, targetFormat: FORMATS.OPENAI, provider: "openai" }));
    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.type).toBe("message");
    expect(json).not.toHaveProperty("choices");
    expect(json.content).toEqual([
      { type: "text", text: "Sure." },
      { type: "tool_use", id: "call_7", name: "shell", input: { cmd: "pwd" } },
    ]);
    expect(json.stop_reason).toBe("tool_use");
    expect(json.usage).toEqual({ input_tokens: 9, output_tokens: 4 });
  });

  it("OpenAI client ← chat SSE: chat.completion (unchanged behaviour)", async () => {
    const result = await handleForcedSSEToJson(forcedCtx({ providerResponse: sseResponse(CHAT_SSE), sourceFormat: FORMATS.OPENAI, targetFormat: FORMATS.OPENAI, provider: "openai" }));
    const json = await result.response.json();
    expect(json.object).toBe("chat.completion");
    expect(json.choices[0].message.content).toBe("Sure.");
    expect(json.choices[0].message.tool_calls[0].function).toEqual({ name: "shell", arguments: "{\"cmd\":\"pwd\"}" });
  });

  it("Responses client ← chat SSE: Responses object (unchanged behaviour)", async () => {
    const result = await handleForcedSSEToJson(forcedCtx({ providerResponse: sseResponse(CHAT_SSE), sourceFormat: FORMATS.OPENAI_RESPONSES, targetFormat: FORMATS.OPENAI, provider: "openai" }));
    const json = await result.response.json();
    expect(json.object).toBe("response");
    expect(json.status).toBe("completed");
    expect(json.output.find((o) => o.type === "function_call")).toMatchObject({ call_id: "call_7", name: "shell" });
  });

  it("Claude client ← Responses SSE (Codex-style provider): Anthropic message", async () => {
    const result = await handleForcedSSEToJson(forcedCtx({ providerResponse: sseResponse(RESPONSES_SSE), sourceFormat: FORMATS.CLAUDE, targetFormat: FORMATS.OPENAI_RESPONSES, provider: "codex" }));
    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.type).toBe("message");
    expect(json.content).toEqual([
      { type: "text", text: "codex says hi" },
      { type: "tool_use", id: "call_c1", name: "shell", input: { cmd: "ls" } },
    ]);
    expect(json.stop_reason).toBe("tool_use");
    expect(json.usage).toEqual({ input_tokens: 10, output_tokens: 5 });
  });

  it("OpenAI client ← Responses SSE: chat.completion (unchanged behaviour)", async () => {
    const result = await handleForcedSSEToJson(forcedCtx({ providerResponse: sseResponse(RESPONSES_SSE), sourceFormat: FORMATS.OPENAI, targetFormat: FORMATS.OPENAI_RESPONSES, provider: "codex" }));
    const json = await result.response.json();
    expect(json.object).toBe("chat.completion");
    expect(json.choices[0].message.content).toBe("codex says hi");
    expect(json.choices[0].finish_reason).toBe("tool_calls");
  });
});
