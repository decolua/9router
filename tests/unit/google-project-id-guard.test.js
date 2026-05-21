import { beforeEach, describe, expect, it, vi } from "vitest";

const connection = {
  id: "conn-no-project",
  provider: "gemini-cli",
  authType: "oauth",
  name: "no-project@example.com",
  email: "no-project@example.com",
  isActive: true,
  projectId: "",
  accessToken: "access-token",
  refreshToken: "refresh-token",
  providerSpecificData: {},
};

const getProviderConnections = vi.fn();
const updateProviderConnection = vi.fn();
const getSettings = vi.fn();
const getModelInfo = vi.fn();
const getComboModels = vi.fn();
const checkAndRefreshToken = vi.fn();
const getProjectIdForConnection = vi.fn();
const handleChatCore = vi.fn();

vi.mock("../../src/lib/localDb.js", () => ({
  getProviderConnections,
  updateProviderConnection,
  getSettings,
  validateApiKey: vi.fn(),
}));

vi.mock("../../src/lib/network/connectionProxy.js", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => ({
    connectionProxyEnabled: false,
    connectionProxyUrl: "",
    connectionNoProxy: "",
    proxyPoolId: null,
    vercelRelayUrl: "",
  })),
}));

vi.mock("../../src/sse/services/model.js", () => ({
  getModelInfo,
  getComboModels,
}));

vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken,
  updateProviderCredentials: vi.fn(),
}));

vi.mock("../../open-sse/services/projectId.js", () => ({
  getProjectIdForConnection,
}));

vi.mock("../../open-sse/handlers/chatCore.js", () => ({
  handleChatCore,
}));

vi.mock("../../open-sse/utils/claudeHeaderCache.js", () => ({
  cacheClaudeHeaders: vi.fn(),
}));

vi.mock("../../open-sse/services/combo.js", () => ({
  handleComboChat: vi.fn(),
}));

vi.mock("../../open-sse/utils/bypassHandler.js", () => ({
  handleBypassRequest: vi.fn(() => null),
}));

vi.mock("../../src/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

const { handleChat } = await import("../../src/sse/handlers/chat.js");

function makeRequest(model) {
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "hello" }],
      stream: false,
    }),
  });
}

describe("Google OAuth project ID guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSettings.mockResolvedValue({
      requireApiKey: false,
      fallbackStrategy: "fill-first",
    });
    getComboModels.mockResolvedValue(null);
    getProviderConnections.mockResolvedValue([connection]);
    checkAndRefreshToken.mockImplementation(async (_provider, creds) => creds);
    getProjectIdForConnection.mockResolvedValue(null);
    handleChatCore.mockResolvedValue({
      success: true,
      response: new Response(JSON.stringify({ ok: true }), { status: 200 }),
    });
  });

  it.each([
    ["Gemini CLI", "gemini-cli", "gc/gemini-3-pro-preview", "gemini-3-pro-preview"],
    ["Antigravity", "antigravity", "ag/gemini-3-flash", "gemini-3-flash"],
  ])("returns a descriptive 403 instead of sending %s chat without a project ID", async (_label, provider, modelStr, model) => {
    getModelInfo.mockResolvedValue({ provider, model });
    getProviderConnections.mockResolvedValue([{ ...connection, provider }]);

    const response = await handleChat(makeRequest(modelStr));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.message).toContain("Cloud Code project ID");
    expect(body.error.message).toContain("no-project@example.com");
    expect(handleChatCore).not.toHaveBeenCalled();
    expect(updateProviderConnection).toHaveBeenCalledWith(
      "conn-no-project",
      expect.objectContaining({
        testStatus: "unavailable",
        errorCode: 403,
        lastError: expect.stringContaining("Cloud Code project ID"),
      }),
    );
  });
});
