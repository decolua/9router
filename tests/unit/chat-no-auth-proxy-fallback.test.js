import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  extractApiKey: vi.fn(() => null),
  isValidApiKey: vi.fn(),
  getSettings: vi.fn(),
  getModelInfo: vi.fn(),
  getComboModels: vi.fn(),
  handleChatCore: vi.fn(),
  checkAndRefreshToken: vi.fn(),
  updateProviderCredentials: vi.fn(),
  unavailableResponse: vi.fn((status, message) => new Response(JSON.stringify({ error: { message } }), { status })),
}));

vi.mock("open-sse/index.js", () => ({}));
vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: mocks.clearAccountError,
  extractApiKey: mocks.extractApiKey,
  isValidApiKey: mocks.isValidApiKey,
}));
vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
}));
vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: mocks.getModelInfo,
  getComboModels: mocks.getComboModels,
}));
vi.mock("open-sse/handlers/chatCore.js", () => ({
  handleChatCore: mocks.handleChatCore,
}));
vi.mock("@/lib/headroom/detect", () => ({
  DEFAULT_HEADROOM_URL: "https://headroom.invalid",
}));
vi.mock("@/lib/pxpipe/loader.js", () => ({
  getTransform: vi.fn(),
}));
vi.mock("@/lib/pxpipe/events.js", () => ({
  appendPxpipeEvent: vi.fn(),
}));
vi.mock("open-sse/utils/error.js", () => ({
  errorResponse: vi.fn((status, message) => new Response(JSON.stringify({ error: { message } }), { status })),
  unavailableResponse: mocks.unavailableResponse,
}));
vi.mock("open-sse/services/combo.js", () => ({
  handleComboChat: vi.fn(),
  handleFusionChat: vi.fn(),
  detectRequiredCapabilities: vi.fn(() => new Set()),
}));
vi.mock("open-sse/services/capacityAdapter.js", () => ({
  augmentModelsWithCapacityAdapter: vi.fn((models) => models),
  withCapacityAdapterStripping: vi.fn((handler) => handler),
  getActiveAdapterStrategy: vi.fn(() => "fallback"),
}));
vi.mock("open-sse/utils/bypassHandler.js", () => ({
  handleBypassRequest: vi.fn(() => null),
}));
vi.mock("open-sse/config/runtimeConfig.js", () => ({
  HTTP_STATUS: {
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    NOT_FOUND: 404,
    SERVICE_UNAVAILABLE: 503,
  },
}));
vi.mock("open-sse/translator/formats.js", () => ({
  detectFormatByEndpoint: vi.fn(() => null),
}));
vi.mock("@/sse/utils/logger.js", () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  maskKey: vi.fn(() => "masked"),
  nextTag: vi.fn(() => "tag"),
}));
vi.mock("@/sse/services/tokenRefresh.js", () => ({
  updateProviderCredentials: mocks.updateProviderCredentials,
  checkAndRefreshToken: mocks.checkAndRefreshToken,
}));
vi.mock("open-sse/services/projectId.js", () => ({
  getProjectIdForConnection: vi.fn(),
}));

const { handleChat } = await import("../../src/sse/handlers/chat.js");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSettings.mockResolvedValue({
    requireApiKey: false,
    ccFilterNaming: false,
    providerThinking: {},
  });
  mocks.getModelInfo.mockResolvedValue({ provider: "opencode", model: "deepseek-v4-flash-free" });
  mocks.getComboModels.mockResolvedValue(null);
  mocks.checkAndRefreshToken.mockImplementation(async (_provider, credentials) => credentials);
  mocks.getProviderCredentials
    .mockResolvedValueOnce({
      connectionId: "noauth",
      connectionName: "Public",
      providerSpecificData: { connectionProxyPoolId: "pool-a" },
    })
    .mockResolvedValueOnce({
      connectionId: "noauth",
      connectionName: "Public",
      providerSpecificData: { connectionProxyPoolId: "pool-b" },
    });
  mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: true, cooldownMs: 2000 });
  mocks.handleChatCore.mockResolvedValueOnce({
    success: false,
    status: 429,
    error: "Too Many Requests",
    resetsAtMs: null,
  });
  mocks.handleChatCore.mockImplementationOnce(async ({ onRequestSuccess }) => {
    await onRequestSuccess?.();
    return { success: true, response: new Response("ok", { status: 200 }) };
  });
});

describe("chat no-auth proxy fallback", () => {
  it("passes the failed pool to cooldown and retries with a different pool", async () => {
    const request = new Request("http://router.test/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "opencode/deepseek-v4-flash-free",
        messages: [{ role: "user", content: "hello" }],
      }),
    });

    const response = await handleChat(request);

    expect(response.status).toBe(200);
    expect(mocks.getProviderCredentials).toHaveBeenCalledTimes(2);
    expect(mocks.getProviderCredentials.mock.calls[1][3]).toEqual({
      excludeProxyPoolIds: new Set(["pool-a"]),
    });
    expect(mocks.markAccountUnavailable).toHaveBeenCalledWith(
      "noauth",
      429,
      "Too Many Requests",
      "opencode",
      "deepseek-v4-flash-free",
      null,
      "pool-a",
    );
    expect(mocks.clearAccountError).toHaveBeenCalledWith(
      "noauth",
      expect.objectContaining({
        providerSpecificData: { connectionProxyPoolId: "pool-b" },
      }),
      "deepseek-v4-flash-free",
      "opencode",
    );
  });

  it("returns unavailable after every pool fails without retrying a pool", async () => {
    mocks.getProviderCredentials.mockReset();
    const exclusionSnapshots = [];
    const credentialResponses = [
      {
        connectionId: "noauth",
        connectionName: "Public",
        providerSpecificData: { connectionProxyPoolId: "pool-a" },
      },
      {
        connectionId: "noauth",
        connectionName: "Public",
        providerSpecificData: { connectionProxyPoolId: "pool-b" },
      },
      {
        allRateLimited: true,
        retryAfter: "2026-08-13T00:00:10.000Z",
        retryAfterHuman: "reset after 10s",
        lastError: "429 from pool-b",
        lastErrorCode: 429,
      },
    ];
    mocks.getProviderCredentials.mockImplementation(async (_provider, _excludeConnectionIds, _model, options) => {
      exclusionSnapshots.push(new Set(options?.excludeProxyPoolIds ?? []));
      return credentialResponses.shift();
    });
    mocks.markAccountUnavailable.mockReset();
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: true, cooldownMs: 2000 });
    mocks.handleChatCore.mockReset();
    mocks.handleChatCore
      .mockResolvedValueOnce({ success: false, status: 429, error: "429 from pool-a", resetsAtMs: null })
      .mockResolvedValueOnce({ success: false, status: 429, error: "429 from pool-b", resetsAtMs: null });

    const request = new Request("http://router.test/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "opencode/deepseek-v4-flash-free",
        messages: [{ role: "user", content: "hello" }],
      }),
    });

    const response = await handleChat(request);

    expect(response.status).toBe(429);
    expect(mocks.getProviderCredentials).toHaveBeenCalledTimes(3);
    expect(exclusionSnapshots).toEqual([
      new Set(),
      new Set(["pool-a"]),
      new Set(["pool-a", "pool-b"]),
    ]);
    expect(mocks.markAccountUnavailable).toHaveBeenCalledTimes(2);
    expect(mocks.unavailableResponse).toHaveBeenCalledWith(
      429,
      expect.stringContaining("429 from pool-b"),
      "2026-08-13T00:00:10.000Z",
      "reset after 10s",
    );
  });
});
