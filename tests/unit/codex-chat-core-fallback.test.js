import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.hoisted(() => vi.fn());

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: vi.fn(() => ({
    execute: executeMock,
    refreshCredentials: vi.fn(async () => null),
  })),
}));
vi.mock("../../open-sse/services/provider.js", () => ({
  detectFormat: vi.fn(() => "openai-responses"),
  getTargetFormat: vi.fn(() => "openai-responses"),
  resolveTransport: vi.fn(() => null),
}));
vi.mock("../../open-sse/translator/index.js", () => ({
  register: vi.fn(),
  needsTranslation: vi.fn(() => false),
  translateRequest: vi.fn((_source, _target, upstreamModel, body) => ({ ...body, model: upstreamModel })),
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
vi.mock("../../open-sse/utils/bypassHandler.js", () => ({ handleBypassRequest: vi.fn(() => null) }));
vi.mock("../../open-sse/utils/streamHandler.js", () => ({
  createStreamController: vi.fn(() => ({
    signal: undefined,
    handleComplete: vi.fn(),
    handleError: vi.fn(),
  })),
}));
vi.mock("../../open-sse/services/tokenRefresh.js", () => ({ refreshWithRetry: vi.fn() }));
vi.mock("../../open-sse/translator/formats/claude.js", () => ({ normalizeClaudePassthrough: vi.fn() }));
vi.mock("../../open-sse/utils/toolDeduper.js", () => ({
  dedupeTools: vi.fn((tools) => ({ tools, stripped: [] })),
}));
vi.mock("../../open-sse/rtk/caveman.js", () => ({ injectCaveman: vi.fn() }));
vi.mock("../../open-sse/rtk/ponytail.js", () => ({ injectPonytail: vi.fn() }));
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
vi.mock("../../open-sse/rtk/pxpipe.js", () => ({ compressWithPxpipe: vi.fn(async () => ({ summary: null })) }));
vi.mock("../../open-sse/providers/capabilities.js", () => ({ getCapabilitiesForModel: vi.fn(() => ({})) }));
vi.mock("../../open-sse/translator/concerns/modality.js", () => ({ stripUnsupportedModalities: vi.fn(() => false) }));
vi.mock("../../open-sse/translator/concerns/prefetch.js", () => ({ prefetchRemoteImages: vi.fn(async () => 0) }));
vi.mock("../../open-sse/handlers/chatCore/requestDetail.js", () => ({
  buildRequestDetail: vi.fn((detail) => detail),
  extractRequestConfig: vi.fn((body, stream) => ({ model: body.model, stream })),
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

describe("chatCore request-scoped Codex failures", () => {
  beforeEach(() => {
    executeMock.mockReset();
  });

  it("preserves status and fallback scope from executor validation", async () => {
    const error = new Error("Unsupported reasoning mode turbo");
    error.status = 400;
    error.fallbackScope = "request";
    executeMock.mockRejectedValue(error);
    const log = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      errorLine: vi.fn(),
      line: vi.fn(),
    };

    const result = await handleChatCore({
      body: {
        model: "codex/gpt-5.6-sol-pro",
        input: "PRIVATE PROMPT",
        reasoning: { mode: "turbo", effort: "max" },
      },
      modelInfo: { provider: "codex", model: "gpt-5.6-sol-pro" },
      credentials: { accessToken: "secret-token", connectionId: "conn-1" },
      log,
      connectionId: "conn-1",
      sourceFormatOverride: "openai-responses",
      clientRawRequest: {
        endpoint: "/v1/responses",
        body: { model: "cx/gpt-5.6-sol-pro", input: "PRIVATE PROMPT" },
        headers: {},
      },
    });

    expect(result).toMatchObject({ success: false, status: 400, fallbackScope: "request" });
    expect(result.response.status).toBe(400);
    const routeLine = log.info.mock.calls.find(([topic]) => topic === "CODEX_ROUTE")?.[1];
    expect(routeLine).toContain("fallback_scope=request");
    expect(routeLine).not.toContain("PRIVATE PROMPT");
    expect(routeLine).not.toContain("secret-token");
  });
});
