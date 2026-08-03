import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkAndRefreshToken: vi.fn(),
  getComboModels: vi.fn(),
  getModelInfo: vi.fn(),
  getProviderCredentials: vi.fn(),
  getSettings: vi.fn(),
  handleChatCore: vi.fn(),
  markAccountUnavailable: vi.fn(),
}));

vi.mock("open-sse/index.js", () => ({}));
vi.mock("../../src/sse/services/auth.js", () => ({
  clearAccountError: vi.fn(),
  extractApiKey: vi.fn(() => null),
  getProviderCredentials: mocks.getProviderCredentials,
  isValidApiKey: vi.fn(),
  markAccountUnavailable: mocks.markAccountUnavailable,
}));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings }));
vi.mock("../../src/sse/services/model.js", () => ({
  getComboModels: mocks.getComboModels,
  getModelInfo: mocks.getModelInfo,
}));
vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: mocks.handleChatCore }));
vi.mock("open-sse/utils/claudeHeaderCache.js", () => ({ cacheClaudeHeaders: vi.fn() }));
vi.mock("@/lib/headroom/detect", () => ({ DEFAULT_HEADROOM_URL: "http://headroom.test" }));
vi.mock("@/lib/pxpipe/loader.js", () => ({ getTransform: vi.fn(async () => null) }));
vi.mock("@/lib/pxpipe/events.js", () => ({ appendPxpipeEvent: vi.fn() }));
vi.mock("open-sse/utils/error.js", () => ({
  errorResponse: vi.fn((status, message) => new Response(message, { status })),
  unavailableResponse: vi.fn((status, message) => new Response(message, { status })),
}));
vi.mock("open-sse/services/combo.js", () => ({
  handleComboChat: vi.fn(),
  handleFusionChat: vi.fn(),
}));
vi.mock("open-sse/utils/bypassHandler.js", () => ({ handleBypassRequest: vi.fn(() => null) }));
vi.mock("open-sse/translator/formats.js", async (importOriginal) => ({
  ...(await importOriginal()),
  detectFormatByEndpoint: vi.fn(() => "openai"),
}));
vi.mock("../../src/sse/utils/logger.js", () => ({
  debug: vi.fn(),
  info: vi.fn(),
  maskKey: vi.fn(() => "masked"),
  warn: vi.fn(),
}));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: mocks.checkAndRefreshToken,
  updateProviderCredentials: vi.fn(),
}));
vi.mock("open-sse/services/projectId.js", () => ({ getProjectIdForConnection: vi.fn() }));

const { handleChat } = await import("../../src/sse/handlers/chat.js");
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("chat request correlation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireApiKey: false });
    mocks.getComboModels.mockResolvedValue(null);
    mocks.getModelInfo.mockResolvedValue({ provider: "github", model: "gpt-test" });
    mocks.checkAndRefreshToken.mockImplementation(async (_provider, credentials) => credentials);
  });

  it("keeps one server correlation id while account fallback gets a new attempt id", async () => {
    mocks.getProviderCredentials
      .mockResolvedValueOnce({ connectionId: "account-a", connectionName: "Account A", providerSpecificData: {} })
      .mockResolvedValueOnce({ connectionId: "account-b", connectionName: "Account B", providerSpecificData: {} });
    mocks.handleChatCore
      .mockResolvedValueOnce({ success: false, status: 429, error: "rate limited", response: new Response("rate", { status: 429 }) })
      .mockResolvedValueOnce({ success: true, response: Response.json({ ok: true }) });
    mocks.markAccountUnavailable.mockResolvedValueOnce({ shouldFallback: true });
    const request = new Request("https://router.test/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Request-ID": "client-controlled-id",
      },
      body: JSON.stringify({ model: "github/gpt-test", messages: [] }),
    });

    const response = await handleChat(request);

    expect(response.status).toBe(200);
    expect(mocks.handleChatCore).toHaveBeenCalledTimes(2);
    const attempts = mocks.handleChatCore.mock.calls.map(([options]) => options);
    expect(attempts[0].correlationId).toBe(attempts[1].correlationId);
    expect(attempts[0].correlationId).toMatch(UUID_V4_RE);
    expect(attempts[0].correlationId).not.toBe("client-controlled-id");
    expect(attempts[0].attemptId).toMatch(UUID_V4_RE);
    expect(attempts[1].attemptId).toMatch(UUID_V4_RE);
    expect(attempts[0].attemptId).not.toBe(attempts[1].attemptId);
  });
});
