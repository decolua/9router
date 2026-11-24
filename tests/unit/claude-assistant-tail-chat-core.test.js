import { describe, it, expect, vi, beforeEach } from "vitest";
import "../translator/registerAll.js";

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
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

describe("final Claude assistant normalization at dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn(async () => { throw new Error("unexpected network request"); });
    executeMock.mockImplementation(async () => ({
      response: new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "synthetic fallback" } }), { status: 400 }),
      url: "https://example.invalid/v1/messages", headers: {}, transformedBody: null,
    }));
  });

  const run = (body, sourceFormat, headers = {}, headroomEnabled = false) => handleChatCore({
    body, sourceFormatOverride: sourceFormat,
    modelInfo: { provider: "claude", model: "claude-sonnet-4-5" },
    credentials: { apiKey: "test-key", providerSpecificData: {} },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    connectionId: "test-tail", headroomEnabled, headroomUrl: "http://localhost:8787",
    rtkEnabled: false, cavemanEnabled: false, ponytailEnabled: false,
    clientRawRequest: { endpoint: sourceFormat === "claude" ? "/v1/messages" : "/v1/chat/completions", body: {}, headers },
  });

  it.each([
    ["native Claude", "claude", { "user-agent": "claude-cli" }],
    ["same-format Claude", "claude", {}],
    ["converted OpenAI", "openai", {}],
  ])("normalizes %s before the executor", async (_name, sourceFormat, headers) => {
    const body = { stream: false, max_tokens: 1024, messages: [
      { role: "user", content: "hello" }, { role: "assistant", content: "prefill  \n" },
    ] };
    const result = await run(body, sourceFormat, headers);
    expect(result.success).toBe(false);
    expect(executeMock).toHaveBeenCalledOnce();
    const content = executeMock.mock.calls[0][0].body.messages.at(-1).content;
    expect(typeof content === "string" ? content : content.at(-1).text).toBe("prefill");
    // A failed provider attempt must leave the original text available to fallback.
    const originalContent = body.messages.at(-1).content;
    expect(typeof originalContent === "string" ? originalContent : originalContent.at(-1).text).toBe("prefill  \n");
  });

  it("leaves final OpenAI assistant whitespace alone", async () => {
    await handleChatCore({
      body: { stream: false, messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "keep  " }] },
      sourceFormatOverride: "openai", modelInfo: { provider: "openai", model: "gpt-4o" },
      credentials: { apiKey: "test-key", providerSpecificData: {} },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      clientRawRequest: { endpoint: "/v1/chat/completions", body: {}, headers: {} },
    });
    expect(executeMock.mock.calls[0][0].body.messages.at(-1).content).toBe("keep  ");
  });

  it("normalizes whitespace introduced by Headroom after translation", async () => {
    global.fetch = vi.fn(async (_url, init) => {
      const payload = JSON.parse(init.body);
      return Response.json({
        messages: payload.messages.map((message) => message.role === "assistant"
          ? { ...message, content: "compressed  \n" } : message),
        tokens_before: 100, tokens_after: 50, tokens_saved: 50,
      });
    });
    await run({ stream: false, max_tokens: 1024, messages: [
      { role: "user", content: "hello" }, { role: "assistant", content: "prefill" },
    ] }, "openai", {}, true);
    expect(global.fetch).toHaveBeenCalledOnce();
    expect(executeMock.mock.calls[0][0].body.messages.at(-1).content.at(-1).text).toBe("compressed");
  });
});
