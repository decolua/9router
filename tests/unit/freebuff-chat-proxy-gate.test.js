import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({ noAuth: true, execute: executeMock }),
}));

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn(),
  }),
}));

vi.mock("../../open-sse/utils/stream.js", () => ({
  COLORS: { red: "", reset: "" },
  createPassthroughStreamWithLogger: vi.fn(() => new TransformStream()),
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

function request(providerSpecificData) {
  return handleChatCore({
    body: { model: "model-a", stream: false, messages: [{ role: "user", content: "hello" }] },
    modelInfo: { provider: "freebuff", model: "model-a" },
    credentials: { accessToken: "test", providerSpecificData },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    connectionId: "connection-a",
    rtkEnabled: false, cavemanEnabled: false, ponytailEnabled: false,
    clientRawRequest: { endpoint: "/v1/chat/completions", body: {}, headers: { accept: "application/json" } },
  });
}

describe("Freebuff chat proxy boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 503 without executor dispatch when no fit pool is available", async () => {
    const response = await request({ noFitPool: true });

    expect(response.status).toBe(503);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("returns 503 without executor dispatch when Freebuff would use direct egress", async () => {
    const response = await request({});

    expect(response.status).toBe(503);
    expect(executeMock).not.toHaveBeenCalled();
  });
});
