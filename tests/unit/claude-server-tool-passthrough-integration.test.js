import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("../../open-sse/utils/bypassHandler.js", () => ({
  handleBypassRequest: vi.fn(() => null),
}));

vi.mock("../../open-sse/utils/streamHandler.js", () => ({
  createStreamController: vi.fn(() => ({
    signal: undefined,
    handleComplete: vi.fn(),
    handleError: vi.fn(),
  })),
}));

vi.mock("../../open-sse/services/tokenRefresh.js", () => ({
  refreshWithRetry: vi.fn(),
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
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

describe("handleChatCore native Claude server-tool passthrough", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeMock.mockRejectedValue(new Error("stop after outbound body capture"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("normalizes the nested Advisor model at the final executor dispatch boundary", async () => {
    const body = {
      model: "cc/claude-sonnet-5",
      max_tokens: 128,
      stream: false,
      system: [{ type: "text", text: "Claude Code 2.1.211" }],
      messages: [
        { role: "user", content: [{ type: "text", text: "Consult the advisor." }] },
      ],
      tools: [
        {
          name: "Read",
          description: "Read a file",
          input_schema: { type: "object", properties: { file_path: { type: "string" } } },
        },
        {
          type: "advisor_20260301",
          name: "advisor",
          model: "cc/claude-opus-4-8",
          input_schema: { type: "object", properties: { question: { type: "string" } } },
        },
      ],
    };

    await handleChatCore({
      body,
      modelInfo: { provider: "claude", model: "claude-sonnet-5" },
      credentials: { accessToken: "test-token", providerSpecificData: {} },
      connectionId: "test-claude-connection",
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      clientRawRequest: {
        endpoint: "/v1/messages",
        body,
        headers: {
          accept: "application/json",
          "user-agent": "claude-cli/2.1.211",
          "x-app": "cli",
        },
      },
    });

    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(executeMock.mock.calls[0][0].body).toEqual({
      model: "claude-sonnet-5",
      max_tokens: 128,
      stream: false,
      system: [{ type: "text", text: "Claude Code 2.1.211" }],
      messages: [
        { role: "user", content: [{ type: "text", text: "Consult the advisor." }] },
      ],
      tools: [
        {
          name: "Read",
          description: "Read a file",
          input_schema: { type: "object", properties: { file_path: { type: "string" } } },
        },
        {
          type: "advisor_20260301",
          name: "advisor",
          model: "claude-opus-4-8",
          input_schema: { type: "object", properties: { question: { type: "string" } } },
        },
      ],
    });
  });
});
