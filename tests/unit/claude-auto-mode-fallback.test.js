import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { handleForcedSSEToJson } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");
const { handleNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");
const { handleComboChat } = await import("../../open-sse/services/combo.js");
const {
  isClaudeClassifierRequest,
  openAICompletionToClaudeMessage,
} = await import("../../open-sse/handlers/chatCore/claudeMessageResponse.js");

function makeResponsesSseResponse(items, usage = { input_tokens: 11, output_tokens: 3, total_tokens: 14 }) {
  const encoder = new TextEncoder();
  const raw = [
    'event: response.created',
    'data: {"type":"response.created","response":{"id":"resp_classifier","created_at":1700000000}}',
    "",
    ...items.flatMap((item, index) => ([
      "event: response.output_item.done",
      `data: ${JSON.stringify({ type: "response.output_item.done", output_index: index, item })}`,
      "",
    ])),
    "event: response.completed",
    `data: ${JSON.stringify({ type: "response.completed", response: { id: "resp_classifier", status: "completed", usage } })}`,
    "",
  ].join("\n");

  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(raw));
      controller.close();
    },
  }), {
    headers: { "content-type": "text/event-stream" },
  });
}

function makeChatCompletionsSseResponse(chunks) {
  const encoder = new TextEncoder();
  const raw = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}`).join("\n\n")}\n\ndata: [DONE]\n`;
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(raw));
      controller.close();
    },
  }), {
    headers: { "content-type": "text/event-stream" },
  });
}

function makeOpenAIJsonResponse(content) {
  return new Response(JSON.stringify({
    id: "chatcmpl_classifier",
    object: "chat.completion",
    created: 1700000000,
    model: "gpt-5.5",
    choices: [{
      index: 0,
      message: { role: "assistant", content },
      finish_reason: "stop",
    }],
    usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 },
  }), {
    headers: { "content-type": "application/json" },
  });
}

function makeClassifierBody(overrides = {}) {
  return {
    model: "subscription",
    stream: false,
    system: "You are the security monitor for Claude Code. Reply with exactly one <block> decision.",
    stop_sequences: ["</block>"],
    messages: [{ role: "user", content: "Can I continue?" }],
    ...overrides,
  };
}

async function runForcedClaudeResponses(items, body = makeClassifierBody()) {
  return handleForcedSSEToJson({
    providerResponse: makeResponsesSseResponse(items),
    sourceFormat: FORMATS.CLAUDE,
    provider: "codex",
    model: "gpt-5.6-terra",
    body,
    stream: false,
    requestStartTime: Date.now(),
    connectionId: "test-connection",
    clientRawRequest: { endpoint: "/v1/messages", body },
    trackDone: vi.fn(),
    appendLog: vi.fn(),
  });
}

async function runForcedClaudeChatCompletionSse(chunks, body = makeClassifierBody()) {
  return handleForcedSSEToJson({
    providerResponse: makeChatCompletionsSseResponse(chunks),
    sourceFormat: FORMATS.CLAUDE,
    provider: "openai",
    model: "gpt-5.5",
    body,
    stream: false,
    requestStartTime: Date.now(),
    connectionId: "test-connection",
    clientRawRequest: { endpoint: "/v1/messages", body },
    trackDone: vi.fn(),
    appendLog: vi.fn(),
  });
}

async function runNonStreamingClaudeJson(providerResponse, body = makeClassifierBody()) {
  return handleNonStreamingResponse({
    providerResponse,
    provider: "openai",
    model: "gpt-5.5",
    sourceFormat: FORMATS.CLAUDE,
    targetFormat: FORMATS.OPENAI,
    body,
    stream: false,
    translatedBody: body,
    finalBody: body,
    requestStartTime: Date.now(),
    connectionId: "test-connection",
    clientRawRequest: { endpoint: "/v1/messages", body },
    trackDone: vi.fn(),
    appendLog: vi.fn(),
    reqLogger: {
      logProviderResponse: vi.fn(),
      logConvertedResponse: vi.fn(),
    },
    log: { line: vi.fn() },
  });
}

describe("Claude Code auto-mode fallback", () => {
  it("detects classifier payloads from Anthropic-style system arrays", () => {
    expect(isClaudeClassifierRequest(makeClassifierBody({
      system: [{ type: "text", text: "You are the security monitor for Claude Code." }],
    }))).toBe(true);
  });

  it("does not mis-detect near-miss payloads without the stop sequence or security monitor marker", () => {
    expect(isClaudeClassifierRequest(makeClassifierBody({
      stop_sequences: ["</done>"],
    }))).toBe(false);
    expect(isClaudeClassifierRequest(makeClassifierBody({
      system: "You are a helpful assistant.",
    }))).toBe(false);
  });

  it("fails closed when classifier mode receives no choices at all", () => {
    expect(() => openAICompletionToClaudeMessage({}, { classifierMode: true })).toThrow(/invalid decision/i);
    expect(() => openAICompletionToClaudeMessage({ choices: [] }, { classifierMode: true })).toThrow(/invalid decision/i);
  });

  it("returns a real Anthropic Message JSON for a classifier allow decision from Responses SSE", async () => {
    const result = await runForcedClaudeResponses([
      { type: "reasoning", summary: [{ type: "summary_text", text: "Looks safe." }] },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "<block>no</block>" }] },
    ]);
    const json = await result.response.json();

    expect(result.success).toBe(true);
    expect(json).toMatchObject({
      id: "resp_classifier",
      type: "message",
      role: "assistant",
      model: "gpt-5.6-terra",
    });
    expect(json.content).toEqual([{ type: "text", text: "<block>no</block>" }]);
  });

  it("preserves a classifier deny decision from GPT fallback", async () => {
    const result = await runForcedClaudeResponses([
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "<block>yes</block>" }] },
    ]);
    const json = await result.response.json();

    expect(result.success).toBe(true);
    expect(json.content).toEqual([{ type: "text", text: "<block>yes</block>" }]);
  });

  it("fails closed when the classifier response is prose instead of a block decision", async () => {
    const result = await runForcedClaudeResponses([
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "This looks safe to me." }] },
    ]);
    const json = await result.response.json();

    expect(result.success).toBe(false);
    expect(result.response.status).toBe(502);
    expect(json.error.message).toMatch(/classifier/i);
  });

  it("fails closed when the classifier response is empty", async () => {
    const result = await runForcedClaudeResponses([
      { type: "message", role: "assistant", content: [] },
    ]);
    const json = await result.response.json();

    expect(result.success).toBe(false);
    expect(result.response.status).toBe(502);
    expect(json.error.message).toMatch(/classifier/i);
  });

  it("returns Anthropic Message JSON for non-streaming OpenAI JSON classifier allow decisions", async () => {
    const result = await runNonStreamingClaudeJson(makeOpenAIJsonResponse("<block>no</block>"));
    const json = await result.response.json();

    expect(result.success).toBe(true);
    expect(json.type).toBe("message");
    expect(json.content).toEqual([{ type: "text", text: "<block>no</block>" }]);
  });

  it("fails closed for malformed non-streaming OpenAI JSON classifier decisions", async () => {
    const result = await runNonStreamingClaudeJson(makeOpenAIJsonResponse("allow"));
    const json = await result.response.json();

    expect(result.success).toBe(false);
    expect(result.response.status).toBe(502);
    expect(json.error.message).toMatch(/classifier/i);
  });

  it("returns Anthropic Message JSON for standard chat-completions SSE classifier decisions", async () => {
    const result = await runForcedClaudeChatCompletionSse([
      {
        id: "chatcmpl_sse",
        object: "chat.completion.chunk",
        created: 1700000000,
        model: "gpt-5.5",
        choices: [{ index: 0, delta: { content: "<block>no</block>" }, finish_reason: "stop" }],
      },
    ]);
    const json = await result.response.json();

    expect(result.success).toBe(true);
    expect(json.type).toBe("message");
    expect(json.content).toEqual([{ type: "text", text: "<block>no</block>" }]);
  });

  it("does not break ordinary non-classifier Claude responses routed through GPT/Codex", async () => {
    const body = makeClassifierBody({
      system: "You are a helpful assistant.",
      stop_sequences: undefined,
    });
    const result = await runForcedClaudeResponses([
      { type: "reasoning", summary: [{ type: "summary_text", text: "I should answer concisely." }] },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "General answer." }] },
    ], body);
    const json = await result.response.json();

    expect(result.success).toBe(true);
    expect(json.type).toBe("message");
    expect(json.content).toEqual([
      { type: "thinking", thinking: "I should answer concisely." },
      { type: "text", text: "General answer." },
    ]);
  });

  it("keeps a successful native Claude classifier response without falling back", async () => {
    const handleSingleModel = vi.fn(async (body, modelStr) => {
      if (modelStr.startsWith("cc/")) {
        return new Response(JSON.stringify({
          id: "msg_claude",
          type: "message",
          role: "assistant",
          model: "claude-opus-4-8",
          content: [{ type: "text", text: "<block>no</block>" }],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected fallback for ${body.model}`);
    });

    const response = await handleComboChat({
      body: makeClassifierBody(),
      models: ["cc/claude-opus-4-8", "cx/gpt-5.6-terra"],
      handleSingleModel,
      log: { info: vi.fn(), warn: vi.fn() },
      comboName: "subscription",
      comboStrategy: "fallback",
    });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.content).toEqual([{ type: "text", text: "<block>no</block>" }]);
    expect(handleSingleModel).toHaveBeenCalledTimes(1);
  });

  it("falls back from Claude to GPT/Codex for classifier responses without changing the schema", async () => {
    const handleSingleModel = vi.fn(async (body, modelStr) => {
      if (modelStr.startsWith("cc/")) {
        return new Response(JSON.stringify({ error: { message: "anthropic overloaded" } }), {
          status: 503,
          headers: { "content-type": "application/json" },
        });
      }

      const result = await runForcedClaudeResponses([
        { type: "reasoning", summary: [{ type: "summary_text", text: "Allow." }] },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "<block>no</block>" }] },
      ], body);
      return result.response;
    });

    const response = await handleComboChat({
      body: makeClassifierBody(),
      models: ["cc/claude-opus-4-8", "cx/gpt-5.6-terra"],
      handleSingleModel,
      log: { info: vi.fn(), warn: vi.fn() },
      comboName: "subscription",
      comboStrategy: "fallback",
    });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.type).toBe("message");
    expect(json.content).toEqual([{ type: "text", text: "<block>no</block>" }]);
    expect(handleSingleModel).toHaveBeenCalledTimes(2);
  });

  it.each([401, 429, 503])("propagates upstream %s failures instead of synthesizing an allow", async (status) => {
    const response = await handleComboChat({
      body: makeClassifierBody(),
      models: ["cc/claude-opus-4-8", "cx/gpt-5.6-terra"],
      handleSingleModel: vi.fn(async () => new Response(JSON.stringify({
        error: { message: `upstream ${status}` },
      }), {
        status,
        headers: { "content-type": "application/json" },
      })),
      log: { info: vi.fn(), warn: vi.fn() },
      comboName: "subscription",
      comboStrategy: "fallback",
    });
    const json = await response.json();

    expect(response.status).toBe(status);
    expect(json.error.message).toContain(`upstream ${status}`);
  });
});
