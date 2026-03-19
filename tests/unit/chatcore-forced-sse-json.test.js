import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { handleForcedSSEToJson } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";

vi.mock("../../open-sse/utils/stream.js", () => ({
  COLORS: { red: "", reset: "" },
}));

vi.mock("../../open-sse/translator/index.js", () => ({
  translateRequest: vi.fn((sourceFormat, targetFormat, model, body) => ({ ...body, model })),
  needsTranslation: vi.fn(() => false),
}));

vi.mock("../../open-sse/services/provider.js", () => ({
  detectFormat: vi.fn(() => FORMATS.OPENAI),
  getTargetFormat: vi.fn(() => FORMATS.OPENAI),
}));

vi.mock("../../open-sse/config/providerModels.js", () => ({
  getModelTargetFormat: vi.fn(() => null),
  PROVIDER_ID_TO_ALIAS: {},
}));

vi.mock("../../open-sse/utils/bypassHandler.js", () => ({
  handleBypassRequest: vi.fn(() => null),
}));

vi.mock("../../open-sse/services/tokenRefresh.js", () => ({
  refreshWithRetry: vi.fn(() => null),
}));

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: vi.fn(async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
    logError: vi.fn(),
  })),
}));

vi.mock("../../open-sse/utils/streamHandler.js", () => ({
  createStreamController: vi.fn(() => ({
    signal: undefined,
    handleComplete: vi.fn(),
    handleError: vi.fn(),
  })),
}));

const executeMock = vi.fn();
vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: vi.fn(() => ({
    execute: executeMock,
    refreshCredentials: vi.fn(async () => null),
  })),
}));

vi.mock("../../open-sse/handlers/chatCore/requestDetail.js", () => ({
  buildRequestDetail: vi.fn(() => ({})),
  extractRequestConfig: vi.fn(() => ({})),
}));

vi.mock("../../open-sse/handlers/chatCore/nonStreamingHandler.js", () => ({
  handleNonStreamingResponse: vi.fn(async () => ({
    success: true,
    response: new Response(JSON.stringify({ fallback: true }), {
      headers: { "Content-Type": "application/json" }
    }),
  })),
}));

vi.mock("../../open-sse/handlers/chatCore/streamingHandler.js", () => ({
  handleStreamingResponse: vi.fn(async () => ({
    success: true,
    response: new Response("stream", { headers: { "Content-Type": "text/event-stream" } }),
  })),
  buildOnStreamComplete: vi.fn(() => ({ onStreamComplete: vi.fn() })),
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

vi.mock("../../open-sse/handlers/chatCore/sseToJsonHandler.js", () => ({
  handleForcedSSEToJson: vi.fn(async () => ({
    success: true,
    response: new Response(JSON.stringify({ object: "response", status: "completed" }), {
      headers: { "Content-Type": "application/json" }
    }),
  })),
}));

describe("handleChatCore forced SSE->JSON decision", () => {
  beforeEach(() => {
    executeMock.mockReset();
    executeMock.mockResolvedValue({
      response: new Response("event: response.completed\ndata: {}\n\n", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
      url: "https://example.com/v1/chat/completions",
      headers: {},
      transformedBody: {},
    });
  });

  it("converts provider-forced SSE to JSON when stream is disabled by Responses endpoint policy", async () => {
    const result = await handleChatCore({
      body: { model: "gpt-x", messages: [{ role: "user", content: "hi" }] },
      modelInfo: { provider: "openai", model: "gpt-x" },
      credentials: { apiKey: "test" },
      clientRawRequest: { endpoint: "/v1/responses", headers: { accept: "application/json" } },
    });

    expect(result.success).toBe(true);
    expect(result.response.headers.get("Content-Type")).toContain("application/json");

    const data = await result.response.json();
    expect(data.object).toBe("response");
    expect(data.status).toBe("completed");
  });

  it("treats OpenAI provider requests as non-streaming by default when stream is omitted", async () => {
    const result = await handleChatCore({
      body: { model: "gpt-x", messages: [{ role: "user", content: "hi" }] },
      modelInfo: { provider: "openai", model: "gpt-x" },
      credentials: { apiKey: "test" },
      clientRawRequest: { endpoint: "/v1/chat/completions", headers: {} },
    });

    expect(result.success).toBe(true);
    expect(result.response.headers.get("Content-Type")).toContain("application/json");

    expect(vi.mocked(handleForcedSSEToJson)).toHaveBeenCalled();
  });

  it("treats OpenAI-compatible Gemini provider requests as non-streaming by default when stream is omitted", async () => {
    const result = await handleChatCore({
      body: { model: "ag/gemini-test-model", messages: [{ role: "user", content: "hello" }] },
      modelInfo: { provider: "antigravity", model: "ag/gemini-test-model" },
      credentials: { accessToken: "test" },
      clientRawRequest: { endpoint: "/v1/chat/completions", headers: {} },
    });

    expect(result.success).toBe(true);
    expect(result.response.headers.get("Content-Type")).toContain("application/json");

    expect(vi.mocked(handleForcedSSEToJson)).toHaveBeenCalled();
  });
});
