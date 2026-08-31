// Guards the provider-level thinking default (dashboard "Thinking: <level>" picker)
// against being outranked by a client's unlevelled thinking intent.
// Cherry Studio's Auto effort sends Claude's thinking:{type:"enabled"} with no
// budget_tokens; extractThinking() reads that field before reasoning_effort, so a
// guard that only tested reasoning_effort let the setting be silently dropped.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeMock, detectClientToolMock, isNativePassthroughMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  detectClientToolMock: vi.fn(() => null),
  isNativePassthroughMock: vi.fn(() => false),
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
  detectClientTool: detectClientToolMock,
  isNativePassthrough: isNativePassthroughMock,
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

// capabilities.js is deliberately NOT mocked: the assertions are about the effort
// that reaches the wire, which the real claude-adaptive capability decides.

const MODEL = "claude-opus-4-6";

// Runs one request through chatCore and returns the body handed to the executor.
async function dispatch({ clientBody, providerThinking }) {
  const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
  const body = { model: MODEL, messages: [{ role: "user", content: "hi" }], ...clientBody };

  await handleChatCore({
    body,
    modelInfo: { provider: "github", model: MODEL },
    credentials: { apiKey: "sk-test" },
    providerThinking,
    clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: {} },
    connectionId: "test-connection",
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });

  expect(executeMock).toHaveBeenCalledTimes(1);
  return executeMock.mock.calls[0][0].body;
}

describe("provider-level thinking default vs client intent", () => {
  beforeEach(() => {
    executeMock.mockReset();
    executeMock.mockRejectedValue(new Error("boom"));
    detectClientToolMock.mockReset();
    detectClientToolMock.mockReturnValue(null);
    isNativePassthroughMock.mockReset();
    isNativePassthroughMock.mockReturnValue(false);
  });

  // The reported failure: dashboard set to High, Cherry Studio sent Auto, and the
  // request 400'd with output_config.effort "auto" instead of using High.
  it("fills in the configured level when the client names none", async () => {
    const sent = await dispatch({
      clientBody: { thinking: { type: "enabled" } },
      providerThinking: { mode: "high" },
    });

    expect(sent.output_config.effort).toBe("high");
  });

  // Distinguishes "the setting was honoured" from "auto happened to fall back to
  // high": every configured level must reach the wire verbatim.
  it.each(["low", "medium", "high", "max"])("honours the configured level %s", async (mode) => {
    const sent = await dispatch({
      clientBody: { thinking: { type: "enabled" } },
      providerThinking: { mode },
    });

    expect(sent.output_config.effort).toBe(mode);
  });

  it("leaves no unlevelled thinking field behind to outrank the injected level", async () => {
    const sent = await dispatch({
      clientBody: { thinking: { type: "enabled" } },
      providerThinking: { mode: "low" },
    });

    // applyThinking re-emits the field from the winning intent; the stale one is gone.
    expect(sent.thinking).toEqual({ type: "adaptive" });
    expect(sent.output_config.effort).toBe("low");
  });

  it("does not override a level the client asked for", async () => {
    const viaEffort = await dispatch({
      clientBody: { reasoning_effort: "low" },
      providerThinking: { mode: "high" },
    });
    expect(viaEffort.output_config.effort).toBe("low");

    executeMock.mockReset();
    executeMock.mockRejectedValue(new Error("boom"));

    // A concrete budget is a named level too (1024 → "low"), not an auto intent.
    const viaBudget = await dispatch({
      clientBody: { thinking: { type: "enabled", budget_tokens: 1024 } },
      providerThinking: { mode: "high" },
    });
    expect(viaBudget.output_config.effort).toBe("low");
  });

  it("respects a client that asked for no thinking at all", async () => {
    const sent = await dispatch({
      clientBody: { thinking: { type: "disabled" } },
      providerThinking: { mode: "high" },
    });

    expect(sent.thinking).toEqual({ type: "disabled" });
    expect(sent.output_config).toBeUndefined();
  });

  it("still injects when the client sends no thinking intent", async () => {
    const sent = await dispatch({ clientBody: {}, providerThinking: { mode: "medium" } });

    expect(sent.output_config.effort).toBe("medium");
  });

  it("leaves the body alone when the provider default is auto", async () => {
    const sent = await dispatch({
      clientBody: { thinking: { type: "enabled" } },
      providerThinking: { mode: "auto" },
    });

    // No configured level to inject — the unlevelled intent resolves in the
    // translator instead, which must still not put "auto" on the wire.
    expect(sent.output_config.effort).not.toBe("auto");
  });

  // Passthrough forwards the client's body untouched and never reads
  // reasoning_effort, so stripping the client's thinking field there would turn
  // thinking off instead of raising it to the configured level.
  it("keeps the client's thinking field on the native passthrough path", async () => {
    detectClientToolMock.mockReturnValue("claude");
    isNativePassthroughMock.mockReturnValue(true);

    const sent = await dispatch({
      clientBody: { thinking: { type: "enabled" } },
      providerThinking: { mode: "high" },
    });

    expect(sent.thinking).toEqual({ type: "enabled" });
  });
});
