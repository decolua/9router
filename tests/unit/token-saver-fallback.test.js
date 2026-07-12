import { describe, it, expect, vi, beforeEach } from "vitest";
// ---------------------------------------------------------------------------
// Token Saver fallback double-count test — account retries must fire exactly
// one recordTokenSaverEvent per request, not per handleChatCore attempt.
// ---------------------------------------------------------------------------

// Mock a provider that reports (1) successful compression telem then (2) fails
// so the fallback loop advances. The mock must be set up early via hoisted.

const { executeMock, recordTokenSaverEventMock } = vi.hoisted(() => {
  // Two calls to executor.execute:
  // Attempt 1 → non-ok response (triggers fallback)
  // Attempt 2 → always the same, but loop exhausts accounts
  const exec = vi.fn().mockResolvedValue({
    response: { ok: false, status: 502, text: async () => "Bad Gateway" },
    url: "https://example.com/v1/chat",
    headers: { "content-type": "application/json" },
    transformedBody: {},
  });
  return {
    executeMock: exec,
    recordTokenSaverEventMock: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({
    noAuth: true,
    execute: executeMock,
    parseError: null,
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

// Router-level auth/token mocks
vi.mock("@/lib/localDb", () => ({
  getSettings: async () => ({}),
  getProviderConnections: async () => [],
}));

// Two accounts: first fails (502), second also fails → loop exhausts
vi.mock("@/sse/services/auth", () => ({
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: async () => ({ shouldFallback: true, cooldownMs: 1000 }),
  clearAccountError: async () => {},
}));

vi.mock("@/sse/services/model", () => ({
  getModelInfo: async () => ({ provider: "openai", model: "gpt-4o" }),
}));

vi.mock("@/sse/services/tokenRefresh", () => ({
  checkAndRefreshToken: async (p, c) => c,
  updateProviderCredentials: async () => {},
}));

vi.mock("@/lib/usageDb", () => ({
  recordTokenSaverEvent: recordTokenSaverEventMock,
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  getUsageStats: vi.fn(),
}));

vi.mock("@/lib/headroom/detect", () => ({
  DEFAULT_HEADROOM_URL: "http://localhost:8787",
}));

vi.mock("@/lib/pxpipe/loader", () => ({
  getTransform: async () => null,
}));

vi.mock("@/lib/pxpipe/events", () => ({
  appendPxpipeEvent: async () => {},
}));

vi.mock("open-sse/services/projectId", () => ({
  getProjectIdForConnection: async () => "test-project",
}));

import { handleSingleModelChat } from "../../src/sse/handlers/chat.js";
import * as authModule from "../../src/sse/services/auth.js";

describe("Token Saver fallback double-count prevention", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authModule.getProviderCredentials)
      // 1st call → first account
      .mockResolvedValueOnce({
        apiKey: "key-1",
        accessToken: "tok-1",
        connectionId: "conn-1",
        connectionName: "Acc01",
        providerSpecificData: {},
      })
      // 2nd call → second account
      .mockResolvedValueOnce({
        apiKey: "key-2",
        accessToken: "tok-2",
        connectionId: "conn-2",
        connectionName: "Acc02",
        providerSpecificData: {},
      })
      // 3rd call → exhausted
      .mockResolvedValueOnce(null);
  });

  it("fires exactly one recordTokenSaverEvent after multiple fallback attempts", async () => {
    await handleSingleModelChat(
      { model: "gpt-4o", stream: false, messages: [{ role: "user", content: "hi" }] },
      "gpt-4o",
      null,
      new Request("http://localhost:3000/v1/chat/completions", {
        headers: { accept: "application/json" },
      }),
      null,
    );

    // Even though handleChatCore was called twice (two fallback attempts),
    // recordTokenSaverEvent must be called exactly once.
    expect(recordTokenSaverEventMock).toHaveBeenCalledTimes(1);
  });
});
