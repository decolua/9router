import { describe, it, expect, vi, beforeEach } from "vitest";
import "../translator/registerAll.js";

const { executeMock, refreshCredentialsMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  refreshCredentialsMock: vi.fn(),
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({
    noAuth: false,
    execute: executeMock,
    refreshCredentials: refreshCredentialsMock,
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

const INITIAL_URL = "https://api.example.com/v1/chat/completions?attempt=initial";
const RETRY_URL = "https://api.example.com/v1/chat/completions?attempt=retry";

function forbidden(body) {
  return new Response(body, {
    status: 403,
    headers: { "content-type": "application/json" },
  });
}

function executeResult(response, url) {
  return { response, url, headers: {}, transformedBody: null };
}

async function runChatCore() {
  const log = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    errorLine: vi.fn(),
  };

  const result = await handleChatCore({
    body: { model: "gpt-4o", stream: false, messages: [{ role: "user", content: "hello" }] },
    modelInfo: { provider: "openai", model: "gpt-4o" },
    credentials: {
      accessToken: "expired-token",
      refreshToken: "refresh-token",
      providerSpecificData: {},
    },
    log,
    connectionId: "test-conn",
    clientRawRequest: {
      endpoint: "/v1/chat/completions",
      body: {},
      headers: { accept: "application/json" },
    },
  });

  return { result, log };
}

describe("handleChatCore token refresh retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn(async (url) => {
      throw new Error(`unexpected fetch: ${url}`);
    });
  });

  it("surfaces the retried 403 payload and URL instead of the first empty 403", async () => {
    executeMock
      .mockResolvedValueOnce(executeResult(forbidden(""), INITIAL_URL))
      .mockResolvedValueOnce(executeResult(
        forbidden(JSON.stringify({ error: { message: "retry token scope denied" } })),
        RETRY_URL
      ));
    refreshCredentialsMock.mockResolvedValue({ accessToken: "new-token" });

    const { result, log } = await runChatCore();

    expect(executeMock).toHaveBeenCalledTimes(2);
    expect(refreshCredentialsMock).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    expect(result.status).toBe(403);
    expect(result.error).toContain("retry token scope denied");

    const errorLine = log.errorLine.mock.calls.at(-1)[2];
    expect(errorLine).toContain("ERROR 403");
    expect(errorLine).toContain("retry token scope denied");
    expect(errorLine).toContain(`URL: ${RETRY_URL}`);
    expect(errorLine).not.toContain(INITIAL_URL);
  });

  it("keeps the original 403 when the refresh returns no access token", async () => {
    executeMock.mockResolvedValueOnce(executeResult(
      forbidden(JSON.stringify({ error: { message: "original quota exhausted" } })),
      INITIAL_URL
    ));
    refreshCredentialsMock.mockResolvedValue({});

    const { result, log } = await runChatCore();

    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(403);
    expect(result.error).toContain("original quota exhausted");
    expect(log.warn).toHaveBeenCalledWith("TOKEN", "OPENAI | refresh failed");

    const errorLine = log.errorLine.mock.calls.at(-1)[2];
    expect(errorLine).toContain("original quota exhausted");
    expect(errorLine).toContain(`URL: ${INITIAL_URL}`);
  });

  it("keeps the original 403 when the retried execute throws", async () => {
    executeMock
      .mockResolvedValueOnce(executeResult(
        forbidden(JSON.stringify({ error: { message: "original forbidden" } })),
        INITIAL_URL
      ))
      .mockRejectedValueOnce(new Error("retry socket closed"));
    refreshCredentialsMock.mockResolvedValue({ accessToken: "new-token" });

    const { result, log } = await runChatCore();

    expect(executeMock).toHaveBeenCalledTimes(2);
    expect(result.status).toBe(403);
    expect(result.error).toContain("original forbidden");
    expect(log.warn).toHaveBeenCalledWith("TOKEN", "OPENAI | retry after refresh failed");

    const errorLine = log.errorLine.mock.calls.at(-1)[2];
    expect(errorLine).toContain("original forbidden");
    expect(errorLine).toContain(`URL: ${INITIAL_URL}`);
  });
});
