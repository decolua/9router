import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeMock, forcedSSEToJsonMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  forcedSSEToJsonMock: vi.fn(),
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

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

vi.mock("../../open-sse/handlers/chatCore/sseToJsonHandler.js", () => ({
  handleForcedSSEToJson: forcedSSEToJsonMock,
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

async function runNativeCodexRequest(model, reasoning, providerThinking) {
  const body = {
    model,
    input: "hello",
    stream: false,
    ...(reasoning ? { reasoning } : {}),
  };

  await handleChatCore({
    body,
    modelInfo: { provider: "codex", model },
    credentials: { accessToken: "test-token", providerSpecificData: {} },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    connectionId: "test-connection",
    rtkEnabled: false,
    headroomEnabled: false,
    cavemanEnabled: false,
    ponytailEnabled: false,
    pxpipeEnabled: false,
    sourceFormatOverride: "openai-responses",
    providerThinking,
    clientRawRequest: {
      endpoint: "/v1/responses",
      body,
      headers: {
        accept: "application/json",
        "user-agent": "codex-cli/0.144.1",
      },
    },
  });

  return executeMock.mock.calls.at(-1)[0].body;
}

describe("native Codex passthrough thinking suffixes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeMock.mockResolvedValue({
      response: new Response("", { status: 200 }),
      url: "https://chatgpt.com/backend-api/codex/responses",
      headers: {},
      transformedBody: null,
    });
    forcedSSEToJsonMock.mockResolvedValue({
      success: true,
      response: new Response("{}", { status: 200 }),
    });
  });

  it("forwards Ultra for Sol", async () => {
    const body = await runNativeCodexRequest("gpt-5.6-sol(ultra)");

    expect(body.model).toBe("gpt-5.6-sol");
    expect(body.reasoning).toEqual({ effort: "ultra" });
  });

  it("converts unsupported Luna Ultra to Max without dropping reasoning metadata", async () => {
    const body = await runNativeCodexRequest("gpt-5.6-luna(ultra)", {
      effort: "low",
      summary: "detailed",
    });

    expect(body.model).toBe("gpt-5.6-luna");
    expect(body.reasoning).toEqual({ effort: "max", summary: "detailed" });
  });

  it("forwards Ultra through a Terra review alias", async () => {
    const body = await runNativeCodexRequest("gpt-5.6-terra-review(ultra)", {
      effort: "low",
    });

    expect(body.model).toBe("gpt-5.6-terra");
    expect(body.reasoning).toEqual({ effort: "ultra" });
  });

  it("does not override native Responses reasoning with provider default", async () => {
    const body = await runNativeCodexRequest(
      "gpt-5.6-luna",
      { effort: "low" },
      { mode: "high" },
    );

    expect(body.reasoning).toEqual({ effort: "low" });
  });
});
