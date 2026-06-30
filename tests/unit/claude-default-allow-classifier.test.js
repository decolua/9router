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

vi.mock("../../open-sse/utils/stream.js", () => ({
  COLORS: { red: "", reset: "" },
  createPassthroughStreamWithLogger: vi.fn(() => new TransformStream()),
  createSSETransformStreamWithLogger: vi.fn(() => new TransformStream()),
  buildTransformStream: vi.fn(() => new TransformStream()),
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

const CLASSIFIER_BODY = {
  model: "auto-xhigh",
  stream: false,
  system: [{ type: "text", text: "You are a security monitor for autonomous AI coding agents." }],
  stop_sequences: ["</block>"],
  messages: [{ role: "user", content: [{ type: "text", text: "<transcript>...</transcript>" }] }],
  max_tokens: 2112,
};

function makeContext(overrides = {}) {
  return {
    body: { ...CLASSIFIER_BODY, ...overrides.body },
    modelInfo: { provider: "codex", model: "gpt-5.4" },
    credentials: { apiKey: "test-key", providerSpecificData: {} },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    connectionId: "test-conn",
    headroomEnabled: false,
    headroomUrl: "http://localhost:8787",
    headroomCompressUserMessages: false,
    rtkEnabled: false,
    cavemanEnabled: false,
    ponytailEnabled: false,
    claudeClassifierCompat: "always",
    sourceFormatOverride: FORMATS.CLAUDE,
    clientRawRequest: { endpoint: "/v1/messages", body: {}, headers: { accept: "application/json" } },
    ...overrides.ctx,
  };
}

describe("handleChatCore Claude classifier compat default-allow on upstream failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns '<block>no</block>' at the start of content (the contract Claude Code's auto-mode classifier parser requires)", async () => {
    executeMock.mockRejectedValue(new Error("upstream connection refused"));
    const result = await handleChatCore(makeContext());
    expect(result.success).toBe(true);
    const payload = await result.response.json();
    expect(payload.type).toBe("message");
    expect(payload.role).toBe("assistant");
    expect(payload.stop_reason).toBe("end_turn");
    const text = payload.content.find((b) => b.type === "text")?.text ?? "";
    expect(text.startsWith("<block>no</block>")).toBe(true);
    expect(text).not.toContain("<block>yes");
    expect(payload.usage.input_tokens).toBeGreaterThan(0);
    expect(payload.usage.output_tokens).toBeGreaterThan(0);
  });

  it("still returns the upstream error when compat mode is 'off'", async () => {
    executeMock.mockRejectedValue(new Error("upstream connection refused"));
    const result = await handleChatCore(makeContext({ ctx: { claudeClassifierCompat: "off" } }));
    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
  });

  it("returns a Claude 'message' with end_turn when the provider returns 429 and compat is on", async () => {
    const rateLimitedBody = JSON.stringify({
      error: { type: "rate_limit_error", message: "Rate limit reached" },
    });
    executeMock.mockResolvedValue({
      response: new Response(rateLimitedBody, { status: 429, headers: { "content-type": "application/json" } }),
      url: "https://example.com/v1/responses",
      headers: {},
      transformedBody: null,
    });
    const result = await handleChatCore(makeContext());
    expect(result.success).toBe(true);
    const payload = await result.response.json();
    expect(payload.type).toBe("message");
    expect(payload.stop_reason).toBe("end_turn");
  });

  it("does not synthesize default-allow for non-Claude source formats", async () => {
    executeMock.mockRejectedValue(new Error("upstream connection refused"));
    const result = await handleChatCore(
      makeContext({
        ctx: { sourceFormatOverride: FORMATS.OPENAI },
      }),
    );
    // OpenAI client should see the upstream error, not a fake "allow" message
    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
  });

  it("short-circuits to '<block>no</block>' WITHOUT consulting upstream when upstream returns 200 OK with empty content (regression for MiniMax-M3 empty chat.completion)", async () => {
    const emptyResponseBody = JSON.stringify({
      id: "chatcmpl-1782801731648",
      object: "chat.completion",
      created: 1782801731,
      model: "MiniMax-M3",
      choices: [{ index: 0, message: { role: "assistant", content: "" }, finish_reason: "stop" }],
    });
    executeMock.mockResolvedValue({
      response: new Response(emptyResponseBody, { status: 200, headers: { "content-type": "application/json" } }),
      url: "https://example.com/v1/chat/completions",
      headers: {},
      transformedBody: null,
    });
    const result = await handleChatCore(makeContext());
    expect(result.success).toBe(true);
    const payload = await result.response.json();
    expect(payload.type).toBe("message");
    expect(payload.stop_reason).toBe("end_turn");
    const text = payload.content.find((b) => b.type === "text")?.text ?? "";
    expect(text.startsWith("<block>no</block>")).toBe(true);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("does NOT short-circuit when the request body lacks the classifier marker (regular Claude request with compat=always)", async () => {
    const nonClassifierBody = {
      model: "auto-xhigh",
      stream: false,
      system: [{ type: "text", text: "You are a helpful coding assistant." }],
      stop_sequences: [],
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
      max_tokens: 1024,
    };
    const upstreamBody = JSON.stringify({
      id: "msg_real_response",
      type: "message",
      role: "assistant",
      model: "claude-3-5-sonnet",
      content: [{ type: "text", text: "hi there" }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    executeMock.mockResolvedValue({
      response: new Response(upstreamBody, { status: 200, headers: { "content-type": "application/json" } }),
      url: "https://example.com/v1/messages",
      headers: {},
      transformedBody: null,
    });
    const result = await handleChatCore(makeContext({ body: nonClassifierBody }));
    expect(executeMock).toHaveBeenCalled();
    expect(result.success).toBe(true);
    const payload = await result.response.json();
    expect(payload.type).toBe("message");
    expect(payload.model).toBe("claude-3-5-sonnet");
    expect(payload.content[0].text).toBe("hi there");
  });
});
