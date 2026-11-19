import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeMock, appendLogMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  appendLogMock: vi.fn(async () => {}),
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({ noAuth: true, execute: executeMock }),
}));

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logError: vi.fn(),
  }),
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: appendLogMock,
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

import { handleChatCore } from "../../open-sse/handlers/chatCore.js";

describe("handleChatCore upstream error status", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    [400, "Bad Request", 502],
    [524, "A timeout occurred", 502],
    [429, "quota exhausted", 429],
    [503, "service busy", 503],
    [500, "Upstream HTTP/2 stream failed", 502],
  ])("maps upstream %i to client status while preserving account status", async (status, message, clientStatus) => {
    executeMock.mockResolvedValue({
      response: new Response(JSON.stringify({ error: { message } }), {
        status,
        headers: { "content-type": "application/json", "retry-after": "2" },
      }),
      url: "https://example.test/v1/chat/completions",
      headers: {},
      transformedBody: null,
    });

    const result = await handleChatCore({
      body: { model: "gpt-4o", stream: false, messages: [{ role: "user", content: "hello" }] },
      modelInfo: { provider: "openai", model: "gpt-4o" },
      credentials: { apiKey: "test-key", providerSpecificData: {} },
      connectionId: "test-connection",
      headroomEnabled: false,
      rtkEnabled: false,
      cavemanEnabled: false,
      ponytailEnabled: false,
      clientRawRequest: { endpoint: "/v1/chat/completions", body: {}, headers: {} },
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(clientStatus);
    expect(result.response.status).toBe(clientStatus);
    expect(result.accountStatus).toBe(status);
    expect((await result.response.json()).error.message).toContain(`[${status}]: ${message}`);
    expect(appendLogMock).toHaveBeenCalledWith(expect.objectContaining({ status: `FAILED ${status}` }));
    expect(executeMock).toHaveBeenCalledTimes(1);
  });
});
