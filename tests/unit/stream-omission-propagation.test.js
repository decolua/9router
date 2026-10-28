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


// Regression: when the client omits `stream`, chatCore resolves it to streaming
// (body.stream !== false) but the translator copies body.stream verbatim — so
// upstream received no stream flag, answered with plain JSON, and the SSE
// pipeline emitted one raw JSON object + "data: [DONE]" (invalid as both).
// The fix forces body.stream to match the resolved decision before translation.
const FORCED = ["openai", "codex", "commandcode"];

function makeOptions(bodyStream) {
  const body = {
    model: "deepseek-v4.1-flash",
    messages: [{ role: "user", content: "hello" }],
  };
  if (bodyStream !== undefined) body.stream = bodyStream;

  return {
    body,
    modelInfo: { provider: "deepseek", model: "deepseek-v4.1-flash" },
    credentials: { apiKey: "sk-test" },
    clientRawRequest: {
      endpoint: "/v1/chat/completions",
      body,
      headers: { accept: "*/*" },
    },
    connectionId: "test-connection",
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

describe("stream flag propagation (body.stream follows resolved decision)", () => {
  beforeEach(() => {
    executeMock.mockReset();
    executeMock.mockRejectedValue(new Error("boom"));
  });

  it("omitted stream propagates true to executor AND translated body", async () => {
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

    await handleChatCore(makeOptions(undefined));

    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(executeMock.mock.calls[0][0].stream).toBe(true);
    expect(executeMock.mock.calls[0][0].body.stream).toBe(true);
  });

  it("explicit stream:false with JSON Accept propagates false", async () => {
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

    await handleChatCore(makeOptions(false));

    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(executeMock.mock.calls[0][0].stream).toBe(false);
    expect(executeMock.mock.calls[0][0].body.stream).toBe(false);
  });

  it("explicit stream:true stays true", async () => {
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

    await handleChatCore(makeOptions(true));

    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(executeMock.mock.calls[0][0].stream).toBe(true);
    expect(executeMock.mock.calls[0][0].body.stream).toBe(true);
  });
});
