import { describe, it, expect, vi, beforeEach } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";

const { executeMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({
    noAuth: true,
    execute: executeMock,
  }),
}));

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
    logError: vi.fn(),
  }),
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

vi.mock("../../open-sse/handlers/chatCore/requestDetail.js", async () => {
  const actual = await vi.importActual("../../open-sse/handlers/chatCore/requestDetail.js");
  return {
    ...actual,
    saveUsageStats: vi.fn(),
  };
});

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

describe("handleChatCore Claude classifier compat non-streaming", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const sse = [
      'event: response.created',
      'data: {"type":"response.created","response":{"id":"resp_compat_nonstream","object":"response","created_at":1,"status":"in_progress"}}',
      '',
      'event: response.output_item.done',
      'data: {"type":"response.output_item.done","output_index":0,"item":{"type":"reasoning","summary":[{"type":"summary_text","text":"internal reasoning that should be suppressed"}]}}',
      '',
      'event: response.output_item.done',
      'data: {"type":"response.output_item.done","output_index":1,"item":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"<block>no</block>"}]}}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed","response":{"id":"resp_compat_nonstream","status":"completed","usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15}}}',
      '',
      'data: [DONE]',
      ''
    ].join("\n");
    executeMock.mockResolvedValue({
      response: new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } }),
      url: "https://chatgpt.com/backend-api/codex/responses",
      headers: {},
      transformedBody: null,
    });
  });

  it("returns a Claude message object without thinking blocks for non-streaming classifier compatibility responses", async () => {
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };

    const result = await handleChatCore({
      body: {
        model: "auto-xhigh",
        stream: false,
        system: [{ type: "text", text: "You are a security monitor for autonomous AI coding agents." }],
        stop_sequences: ["</block>"],
        messages: [{ role: "user", content: [{ type: "text", text: "<transcript>...</transcript>" }] }],
      },
      modelInfo: { provider: "codex", model: "gpt-5.4-high" },
      credentials: { apiKey: "test-key", providerSpecificData: {} },
      log,
      connectionId: "test-conn",
      headroomEnabled: false,
      headroomUrl: "http://localhost:8787",
      headroomCompressUserMessages: false,
      rtkEnabled: false,
      cavemanEnabled: false,
      ponytailEnabled: false,
      claudeClassifierCompat: "always",
      sourceFormatOverride: FORMATS.CLAUDE,
      clientRawRequest: {
        endpoint: "/v1/messages",
        body: {},
        headers: { accept: "application/json" },
      },
    });

    expect(result.success).toBe(true);
    const payload = await result.response.json();
    expect(payload.type).toBe("message");
    expect(payload.content.some((block) => block.type === "thinking")).toBe(false);
    expect(payload.content.some((block) => block.type === "text" && block.text === "<block>no</block>")).toBe(true);
    // usage shape must be Claude-shaped (input/output tokens) so the classifier's
    // JSON parser can read .input_tokens instead of crashing on undefined.
    expect(payload.usage).toBeDefined();
    expect(typeof payload.usage.input_tokens).toBe("number");
    expect(typeof payload.usage.output_tokens).toBe("number");
  });
});

describe("handleChatCore Claude classifier compat non-streaming preserves cache fields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const sse = [
      'event: response.created',
      'data: {"type":"response.created","response":{"id":"resp_compat_cache","object":"response","created_at":1,"status":"in_progress"}}',
      '',
      'event: response.output_item.done',
      'data: {"type":"response.output_item.done","output_index":0,"item":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"<block>no</block>"}]}}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed","response":{"id":"resp_compat_cache","status":"completed","usage":{"input_tokens":2175,"output_tokens":136,"input_tokens_details":{"cached_tokens":23381}}}}',
      '',
      'data: [DONE]',
      '',
    ].join("\n");
    executeMock.mockResolvedValue({
      response: new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } }),
      url: "https://chatgpt.com/backend-api/codex/responses",
      headers: {},
      transformedBody: null,
    });
  });

  it("forwards cache_read_input_tokens from upstream usage into the Claude message", async () => {
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };

    const result = await handleChatCore({
      body: {
        model: "auto-xhigh",
        stream: false,
        system: [{ type: "text", text: "You are a security monitor for autonomous AI coding agents." }],
        stop_sequences: ["</block>"],
        messages: [{ role: "user", content: [{ type: "text", text: "<transcript>...</transcript>" }] }],
      },
      modelInfo: { provider: "codex", model: "gpt-5.4-high" },
      credentials: { apiKey: "test-key", providerSpecificData: {} },
      log,
      connectionId: "test-conn",
      headroomEnabled: false,
      headroomUrl: "http://localhost:8787",
      headroomCompressUserMessages: false,
      rtkEnabled: false,
      cavemanEnabled: false,
      ponytailEnabled: false,
      claudeClassifierCompat: "always",
      sourceFormatOverride: FORMATS.CLAUDE,
      clientRawRequest: {
        endpoint: "/v1/messages",
        body: {},
        headers: { accept: "application/json" },
      },
    });

    expect(result.success).toBe(true);
    const payload = await result.response.json();
    expect(payload.type).toBe("message");
    expect(payload.usage.input_tokens).toBe(2175);
    expect(payload.usage.output_tokens).toBe(136);
    // The cache field MUST be preserved so Claude's parser does not crash on
    // undefined.usage.input_tokens.
    expect(payload.usage.cache_read_input_tokens).toBe(23381);
  });
});

describe("handleChatCore Claude classifier compat non-streaming: provider returned chat.completion JSON", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const body = {
      id: "chatcmpl-compat-json",
      object: "chat.completion",
      created: 1782798415,
      model: "MiniMax-M3",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "<block>no</block>",
            reasoning_content: "internal reasoning that should be suppressed",
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 15703,
        completion_tokens: 437,
        prompt_tokens_details: { cached_tokens: 23381 },
      },
    };
    executeMock.mockResolvedValue({
      response: new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      url: "https://api.example.com/v1/responses",
      headers: {},
      transformedBody: null,
    });
  });

  it("builds a Claude message object when sourceFormat === CLAUDE and targetFormat === OPENAI_RESPONSES", async () => {
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };

    const result = await handleChatCore({
      body: {
        model: "auto-xhigh",
        stream: false,
        system: [{ type: "text", text: "You are a security monitor for autonomous AI coding agents." }],
        stop_sequences: ["</block>"],
        messages: [{ role: "user", content: [{ type: "text", text: "<transcript>...</transcript>" }] }],
      },
      modelInfo: { provider: "openai-compatible-responses-test", model: "test-model" },
      credentials: { apiKey: "test-key", providerSpecificData: {} },
      log,
      connectionId: "test-conn",
      headroomEnabled: false,
      headroomUrl: "http://localhost:8787",
      headroomCompressUserMessages: false,
      rtkEnabled: false,
      cavemanEnabled: false,
      ponytailEnabled: false,
      claudeClassifierCompat: "always",
      sourceFormatOverride: FORMATS.CLAUDE,
      clientRawRequest: {
        endpoint: "/v1/messages",
        body: {},
        headers: { accept: "application/json" },
      },
    });

    expect(result.success).toBe(true);
    const payload = await result.response.json();
    expect(payload.type).toBe("message");
    expect(payload.role).toBe("assistant");
    expect(payload.content.some((b) => b.type === "thinking")).toBe(false);
    expect(payload.content.some((b) => b.type === "text" && b.text === "<block>no</block>")).toBe(true);
    // The usage must be Claude-shaped: input_tokens, output_tokens, and
    // cache_read_input_tokens from the upstream OpenAI `prompt_tokens_details.cached_tokens`.
    // The token counts include a small buffer added by the post-processing
    // pipeline, so we only assert type and the cache field, not exact values.
    expect(typeof payload.usage.input_tokens).toBe("number");
    expect(typeof payload.usage.output_tokens).toBe("number");
    expect(payload.usage.cache_read_input_tokens).toBe(23381);
  });
});
