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

describe("Muse Responses routing", () => {
  beforeEach(() => {
    executeMock.mockReset();
    executeMock.mockRejectedValue(new Error("boom"));
  });

  it("translates OpenCode Go Muse Spark (Responses-only) for Claude clients via targetFormat", async () => {
    // Upstream master routes via targetFormat + executor buildUrl (isResponsesModel),
    // not via runtimeTransport: Claude source has no matching transport for a
    // responses-only model, so credentials.runtimeTransport stays unset while the
    // translated body still reaches the Responses endpoint as `input`.
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
    const { getModelTargetFormat } = await import("../../open-sse/config/providerModels.js");
    expect(getModelTargetFormat("opencode-go", "muse-spark-1.2-contributor")).toBe("openai-responses");
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

    expect(executeMock.mock.calls[0][0].body).toHaveProperty("input");
  });

  it("translates OpenCode Free Muse Spark Free for Claude clients (max_tokens→max_output_tokens)", async () => {
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
    const { body: sentBody } = executeMock.mock.calls.at(-1)[0];
    expect(sentBody.model).toBe(FREE_ID);
    expect(sentBody.input).toBeDefined();
    expect(sentBody.max_tokens).toBeUndefined();
    expect(sentBody.max_output_tokens).toBe(8192);
    expect(sentBody.instructions).toBe("Be concise.");
  });
});
