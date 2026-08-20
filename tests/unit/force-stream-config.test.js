// Guards forceStream moved from chatCore hardcode → PROVIDERS schema (#5).
import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: vi.fn(() => ({
    execute: executeMock,
    refreshCredentials: vi.fn().mockResolvedValue(null),
  })),
}));

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: vi.fn(async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logError: vi.fn(),
  })),
}));

vi.mock("../../open-sse/utils/clientDetector.js", () => ({
  detectClientTool: vi.fn(() => null),
  isNativePassthrough: vi.fn(() => false),
}));

vi.mock("../../open-sse/utils/bypassHandler.js", () => ({
  handleBypassRequest: vi.fn(() => null),
}));

vi.mock("../../open-sse/utils/streamHandler.js", () => ({
  createStreamController: vi.fn(() => ({
    signal: undefined,
    handleComplete: vi.fn(),
    handleError: vi.fn(),
  })),
  pipeWithDisconnect: vi.fn(async () => {}),
}));

vi.mock("../../open-sse/services/tokenRefresh.js", () => ({
  refreshWithRetry: vi.fn(),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  default: vi.fn(),
  proxyAwareFetch: vi.fn(),
}));

vi.mock("../../open-sse/translator/formats/claude.js", () => ({
  normalizeClaudePassthrough: vi.fn(),
  prepareClaudeRequest: vi.fn((body) => body),
}));

vi.mock("../../open-sse/utils/toolDeduper.js", () => ({
  dedupeTools: vi.fn((tools) => ({ tools, stripped: [] })),
}));

vi.mock("../../open-sse/rtk/caveman.js", () => ({
  injectCaveman: vi.fn(),
}));

vi.mock("../../open-sse/rtk/ponytail.js", () => ({
  injectPonytail: vi.fn(),
}));

vi.mock("../../open-sse/rtk/index.js", () => ({
  compressMessages: vi.fn(() => null),
  formatRtkLog: vi.fn(() => ""),
}));

vi.mock("../../open-sse/rtk/headroom.js", () => ({
  compressWithHeadroom: vi.fn(async () => null),
  formatHeadroomLog: vi.fn(() => ""),
  formatHeadroomSizeLog: vi.fn(() => ""),
  isHeadroomPhantomSavings: vi.fn(() => false),
}));

vi.mock("../../open-sse/providers/capabilities.js", () => ({
  getCapabilitiesForModel: vi.fn(() => ({})),
}));

vi.mock("../../open-sse/translator/concerns/modality.js", () => ({
  stripUnsupportedModalities: vi.fn(() => false),
}));

vi.mock("../../open-sse/translator/concerns/prefetch.js", () => ({
  prefetchRemoteImages: vi.fn(async () => 0),
}));

vi.mock("../../open-sse/handlers/chatCore/requestDetail.js", () => ({
  buildRequestDetail: vi.fn((detail) => detail),
  extractRequestConfig: vi.fn((body, stream) => ({ body, stream })),
}));

vi.mock("../../open-sse/utils/error.js", () => ({
  createErrorResult: vi.fn((status, message) => ({ success: false, status, error: message })),
  formatProviderError: vi.fn((error) => error.message),
  parseUpstreamError: vi.fn(),
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
}));

const FORCED = ["openai", "codex", "commandcode"];

function makeOptions(bodyStream) {
  const body = {
    model: "gpt-4.1",
    messages: [{ role: "user", content: "hello" }],
  };
  if (bodyStream !== undefined) body.stream = bodyStream;

  return {
    body,
    modelInfo: { provider: "openai", model: "gpt-4.1" },
    credentials: { apiKey: "sk-test" },
    clientRawRequest: {
      endpoint: "/v1/chat/completions",
      body,
      headers: { accept: "application/json" },
    },
    connectionId: "test-connection",
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

describe("forceStream provider config", () => {
  beforeEach(() => {
    executeMock.mockReset();
    executeMock.mockRejectedValue(new Error("boom"));
  });

  it("only openai/codex/commandcode force streaming", async () => {
    const { PROVIDERS } = await import("../../open-sse/config/providers.js");
    for (const id of FORCED) {
      expect(PROVIDERS[id]?.forceStream, `${id} forced`).toBe(true);
    }
    // a sample of others must NOT force
    for (const id of ["deepseek", "claude", "gemini", "openrouter"]) {
      expect(PROVIDERS[id]?.forceStream, `${id} not forced`).not.toBe(true);
    }
  });

  it.each([undefined, false])( "keeps forced-stream providers streaming for JSON clients when body.stream is %s", async (bodyStream) => {
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

    await handleChatCore(makeOptions(bodyStream));

    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(executeMock.mock.calls[0][0].stream).toBe(true);
  });

  it("routes Responses-only OpenCode Go models to /responses for Claude clients", async () => {
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
    const credentials = { apiKey: "sk-test" };
    const body = {
      model: "ocg/muse-spark-1.2-contributor",
      max_tokens: 128,
      stream: true,
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    };

    await handleChatCore({
      body,
      modelInfo: { provider: "opencode-go", model: "muse-spark-1.2-contributor" },
      credentials,
      sourceFormatOverride: "claude",
      clientRawRequest: {
        endpoint: "/v1/messages",
        body,
        headers: { accept: "text/event-stream" },
      },
      connectionId: "test-connection",
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(credentials.runtimeTransport?.baseUrl).toBe("https://opencode.ai/zen/go/v1/responses");
    expect(executeMock.mock.calls[0][0].body).toHaveProperty("input");
  });
  it("routes OpenCode Free Responses-only model to /zen/v1/responses for Claude clients", async () => {
    const FREE_ID = "muse-spark-1.2-contributor-free";
    const FREE_URL = "https://opencode.ai/zen/v1/responses";
    executeMock.mockResolvedValueOnce({
      response: new Response(JSON.stringify({
        id: "resp_1", object: "response", created_at: 0, status: "completed", model: FREE_ID,
        output: [{ type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "ok", annotations: [] }] }],
      }), { status: 200, headers: { "content-type": "application/json" } }),
      url: FREE_URL, headers: {}, transformedBody: null,
    });

    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
    const credentials = { apiKey: "public", providerSpecificData: {} };
    const result = await handleChatCore({
      body: { model: `opencode/${FREE_ID}`, stream: true, max_tokens: 8192, system: "Be concise.", messages: [{ role: "user", content: "hi" }] },
      modelInfo: { provider: "opencode", model: FREE_ID },
      credentials,
      connectionId: "oc-free-test",
      sourceFormatOverride: "claude",
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(result.success).toBe(true);
    expect(credentials.runtimeTransport?.baseUrl).toBe(FREE_URL);
    const { body: sentBody } = executeMock.mock.calls.at(-1)[0];
    expect(sentBody.model).toBe(FREE_ID);
    expect(sentBody.input).toBeDefined();
    expect(sentBody.max_tokens).toBeUndefined();
    expect(sentBody.max_output_tokens).toBe(8192);
    expect(sentBody.instructions).toBe("Be concise.");
  });

  it("does NOT fall back to a sibling endpoint for the free model without a transport match", async () => {
    const FREE_ID = "muse-spark-1.2-contributor-free";
    executeMock.mockResolvedValueOnce({
      response: new Response(JSON.stringify({
        id: "chatcmpl-1", object: "chat.completion", model: "x",
        choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      }), { status: 200, headers: { "content-type": "application/json" } }),
      url: "https://opencode.ai/zen/v1/chat/completions", headers: {}, transformedBody: null,
    });

    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
    const credentials = { apiKey: "public", providerSpecificData: {} };
    await handleChatCore({
      body: { model: `opencode/${FREE_ID}`, stream: true, messages: [{ role: "user", content: "hi" }] },
      modelInfo: { provider: "opencode", model: FREE_ID },
      credentials,
      connectionId: "oc-free-openai-src",
      sourceFormatOverride: "openai",
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    // openai-format client on a Responses-only model: the per-model guard + model
    // targetFormat route to the Responses endpoint, never a sibling chat/completions.
    expect(credentials.runtimeTransport?.baseUrl).toBe("https://opencode.ai/zen/v1/responses");
  });
});
