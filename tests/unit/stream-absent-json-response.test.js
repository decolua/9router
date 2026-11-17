// #5677 end-to-end: an upstream that answers JSON must never reach the client wrapped as SSE with [DONE].
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
    logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
    appendProviderChunk: vi.fn(),
    appendConvertedChunk: vi.fn(),
    appendOpenAIChunk: vi.fn(),
  })),
}));

vi.mock("../../open-sse/utils/clientDetector.js", () => ({
  detectClientTool: vi.fn(() => null),
  isNativePassthrough: vi.fn(() => false),
}));

vi.mock("../../open-sse/utils/bypassHandler.js", () => ({
  handleBypassRequest: vi.fn(() => null),
}));

vi.mock("../../open-sse/utils/streamHandler.js", async (importOriginal) => ({
  ...(await importOriginal()),
  createStreamController: vi.fn(() => ({
    signal: undefined,
    handleComplete: vi.fn(),
    handleError: vi.fn(),
    isConnected: vi.fn(() => true),
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
  // chatCore also imports these (fb543a1f); a mock missing them fails the import.
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

vi.mock("../../open-sse/handlers/chatCore/requestDetail.js", async (importOriginal) => ({
  ...(await importOriginal()),
  buildRequestDetail: vi.fn((detail) => detail),
  extractRequestConfig: vi.fn((body, stream) => ({ body, stream })),
}));

vi.mock("../../open-sse/utils/error.js", () => ({
  createErrorResult: vi.fn((status, message) => ({ success: false, status, error: message })),
  formatProviderError: vi.fn((error) => error.message),
  parseUpstreamError: vi.fn(),
}));

vi.mock("@/lib/usageDb.js", () => ({
  saveRequestUsage: vi.fn(() => Promise.resolve()),
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
}));


const JSON_BODY = { id: "chatcmpl-1", object: "chat.completion", model: "m", choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };

function makeOptions(bodyStream, accept = "*/*", provider = "deepseek") {
  const body = { model: "m", messages: [{ role: "user", content: "hello" }] };
  if (bodyStream !== undefined) body.stream = bodyStream;
  return {
    body,
    modelInfo: { provider, model: "m" },
    credentials: { apiKey: "sk-test" },
    clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: { accept } },
    connectionId: "c1",
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

describe("#5677 client response shape when upstream replies JSON", { timeout: 20_000 }, () => {
  beforeEach(() => {
    executeMock.mockReset();
    executeMock.mockImplementation(async () => ({
      response: new Response(JSON.stringify(JSON_BODY), { status: 200, headers: { "content-type": "application/json" } }),
      url: "https://up.test", headers: {}, transformedBody: {},
    }));
  });

  it.each([
    ["absent stream, Accept */*", undefined, "*/*"],
    ["absent stream, no Accept", undefined, ""],
    ["explicit stream:false, Accept */*", false, "*/*"],
  ])("returns plain JSON without [DONE]: %s", async (_label, bodyStream, accept) => {
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
    const result = await handleChatCore(makeOptions(bodyStream, accept));
    expect(result.success).toBe(true);
    const ct = result.response.headers.get("content-type") || "";
    const text = await result.response.text();
    expect(ct).not.toContain("text/event-stream");
    expect(text).not.toContain("[DONE]");
    expect(JSON.parse(text).choices[0].message.content).toBe("hi");
  });
});

describe("#5677 forceStream provider whose upstream replies JSON", { timeout: 20_000 }, () => {
  beforeEach(() => {
    executeMock.mockReset();
    executeMock.mockImplementation(async () => ({
      response: new Response(JSON.stringify(JSON_BODY), { status: 200, headers: { "content-type": "application/json" } }),
      url: "https://up.test", headers: {}, transformedBody: {},
    }));
  });

  it("still returns plain JSON to a stream:false client (no SSE wrapper, no [DONE])", async () => {
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
    const result = await handleChatCore(makeOptions(false, "*/*", "openai"));
    expect(result.success).toBe(true);
    const ct = result.response.headers.get("content-type") || "";
    const text = await result.response.text();
    expect(ct).not.toContain("text/event-stream");
    expect(text).not.toContain("[DONE]");
    expect(JSON.parse(text).choices[0].message.content).toBe("hi");
  });
});
