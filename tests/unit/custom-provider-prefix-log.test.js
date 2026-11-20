// Regression: the request log line for a custom provider must show the prefix
// the user configured ("mirai"), not the node id
// ("openai-compatible-chat-<uuid>"). See decolua/9router#5763.
import { describe, it, expect, vi, beforeEach } from "vitest";
import "../translator/registerAll.js";

const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({ noAuth: true, execute: executeMock }),
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

const NODE_ID = "openai-compatible-chat-330c58ab-a28a-46ed-9baa-0e1c8510562c";
const MODEL = "deepseek-v4-flash";

function run(providerSpecificData) {
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), line: vi.fn() };
  return handleChatCore({
    body: { model: `${NODE_ID}/${MODEL}`, stream: false, messages: [{ role: "user", content: "hello" }] },
    modelInfo: { provider: NODE_ID, model: MODEL },
    credentials: { apiKey: "test-key", providerSpecificData, connectionName: "MiraiAPI" },
    log,
    connectionId: "test-conn",
    rtkEnabled: false,
    cavemanEnabled: false,
    ponytailEnabled: false,
    clientRawRequest: {
      endpoint: "/v1/chat/completions",
      body: { model: `${NODE_ID}/${MODEL}` },
      headers: { accept: "application/json" },
    },
  }).then(() => log);
}

describe("custom provider request log line", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeMock.mockResolvedValue({
      response: new Response(JSON.stringify({
        id: "chatcmpl-test",
        object: "chat.completion",
        choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop", index: 0 }],
      }), { status: 200, headers: { "content-type": "application/json" } }),
      url: "https://api.miraiapi.com/v1/chat/completions",
      headers: {},
      transformedBody: null,
    });
  });

  it("shows the configured prefix instead of the node id", async () => {
    const log = await run({ prefix: "mirai" });
    const line = log.line.mock.calls.find((c) => c[1] === "▶");
    expect(line).toBeDefined();
    // The routed target shows the prefix the user configured.
    expect(line[2]).toContain(`→ mirai/${MODEL}`);
    expect(line[2]).not.toContain(`→ ${NODE_ID}/${MODEL}`);
  });

  it("shows the prefix on both sides when the client sends the prefix", async () => {
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), line: vi.fn() };
    await handleChatCore({
      body: { model: `mirai/${MODEL}`, stream: false, messages: [{ role: "user", content: "hello" }] },
      modelInfo: { provider: NODE_ID, model: MODEL },
      credentials: { apiKey: "test-key", providerSpecificData: { prefix: "mirai" }, connectionName: "MiraiAPI" },
      log,
      connectionId: "test-conn",
      rtkEnabled: false,
      cavemanEnabled: false,
      ponytailEnabled: false,
      clientRawRequest: {
        endpoint: "/v1/chat/completions",
        body: { model: `mirai/${MODEL}` },
        headers: { accept: "application/json" },
      },
    });
    const line = log.line.mock.calls.find((c) => c[1] === "▶");
    expect(line).toBeDefined();
    expect(line[2]).toContain(`POST mirai/${MODEL} → mirai/${MODEL}`);
    expect(line[2]).not.toContain(NODE_ID);
  });

  it("falls back to the provider id when no prefix is configured", async () => {
    const log = await run({});
    const line = log.line.mock.calls.find((c) => c[1] === "▶");
    expect(line).toBeDefined();
    expect(line[2]).toContain(`→ ${NODE_ID}/${MODEL}`);
  });
});
