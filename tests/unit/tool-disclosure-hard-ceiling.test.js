import { describe, it, expect, vi, beforeEach } from "vitest";
import { HARD_TOOL_CEILING, _cache } from "../../open-sse/utils/toolDisclosure.js";

// Verifies the always-on safety ceiling wired into handleChatCore
// (open-sse/handlers/chatCore.js): a raw tool count above HARD_TOOL_CEILING
// gets capped before dispatch even when toolDisclosure is completely
// unconfigured — several providers 502 above ~128 tools regardless of
// whether the opt-in BM25 disclosure feature is enabled.

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
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

function mkTools(count) {
  return Array.from({ length: count }, (_, i) => ({
    type: "function",
    function: {
      name: `tool_${i}`,
      description: `Does thing number ${i}`,
      parameters: { type: "object", properties: {} },
    },
  }));
}

describe("handleChatCore hard tool-count ceiling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _cache.clear();
    executeMock.mockResolvedValue({
      response: new Response(JSON.stringify({
        id: "chatcmpl-test",
        object: "chat.completion",
        choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop", index: 0 }],
      }), { status: 200, headers: { "content-type": "application/json" } }),
      url: "https://api.openai.com/v1/chat/completions",
      headers: {},
      transformedBody: null,
    });
  });

  it("caps an oversized tool set even when toolDisclosure is entirely unconfigured", async () => {
    await handleChatCore({
      body: { model: "gpt-4o", stream: false, messages: [{ role: "user", content: "list files" }], tools: mkTools(150) },
      modelInfo: { provider: "openai", model: "gpt-4o" },
      credentials: { apiKey: "test-key", providerSpecificData: {} },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
      connectionId: "test-conn-ceiling-1",
      // toolDisclosure intentionally omitted — this is the default, most common case.
      clientRawRequest: { endpoint: "/v1/chat/completions", body: {}, headers: { accept: "application/json" } },
    });

    expect(executeMock).toHaveBeenCalledTimes(1);
    const dispatchedTools = executeMock.mock.calls[0][0].body.tools;
    expect(dispatchedTools.length).toBeLessThanOrEqual(HARD_TOOL_CEILING);
  });

  it("does not touch a tool set already at or below the ceiling", async () => {
    await handleChatCore({
      body: { model: "gpt-4o", stream: false, messages: [{ role: "user", content: "list files" }], tools: mkTools(10) },
      modelInfo: { provider: "openai", model: "gpt-4o" },
      credentials: { apiKey: "test-key", providerSpecificData: {} },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
      connectionId: "test-conn-ceiling-2",
      clientRawRequest: { endpoint: "/v1/chat/completions", body: {}, headers: { accept: "application/json" } },
    });

    const dispatchedTools = executeMock.mock.calls[0][0].body.tools;
    expect(dispatchedTools.length).toBe(10);
  });

  it("still applies the ceiling when the static filter is on but disclosure (BM25) is off", async () => {
    await handleChatCore({
      body: { model: "gpt-4o", stream: false, messages: [{ role: "user", content: "list files" }], tools: mkTools(150) },
      modelInfo: { provider: "openai", model: "gpt-4o" },
      credentials: { apiKey: "test-key", providerSpecificData: {} },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
      connectionId: "test-conn-ceiling-3",
      toolDisclosure: { filterEnabled: true, disclosureEnabled: false },
      clientRawRequest: { endpoint: "/v1/chat/completions", body: {}, headers: { accept: "application/json" } },
    });

    const dispatchedTools = executeMock.mock.calls[0][0].body.tools;
    expect(dispatchedTools.length).toBeLessThanOrEqual(HARD_TOOL_CEILING);
  });

  it("is skipped when the client sends the token-saver bypass header", async () => {
    await handleChatCore({
      body: { model: "gpt-4o", stream: false, messages: [{ role: "user", content: "list files" }], tools: mkTools(150) },
      modelInfo: { provider: "openai", model: "gpt-4o" },
      credentials: { apiKey: "test-key", providerSpecificData: {} },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
      connectionId: "test-conn-ceiling-4",
      clientRawRequest: {
        endpoint: "/v1/chat/completions",
        body: {},
        headers: { accept: "application/json", "x-9router-token-saver": "off" },
      },
    });

    const dispatchedTools = executeMock.mock.calls[0][0].body.tools;
    expect(dispatchedTools.length).toBe(150);
  });
});
