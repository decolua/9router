import { beforeEach, describe, expect, it, vi } from "vitest";

const getProviderConnections = vi.fn();
const updateProviderConnection = vi.fn();
const getSettings = vi.fn();
const getModelInfo = vi.fn();
const getComboModels = vi.fn();
const checkAndRefreshToken = vi.fn();
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

vi.mock("../../open-sse/handlers/chatCore.js", () => ({
  handleChatCore,
}));

vi.mock("../../open-sse/utils/claudeHeaderCache.js", () => ({
  cacheClaudeHeaders: vi.fn(),
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

describe("combo chat preflight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSettings.mockResolvedValue({
      requireApiKey: false,
      fallbackStrategy: "fill-first",
      comboStrategy: "fallback",
      comboStickyRoundRobinLimit: 1,
    });
    getComboModels.mockImplementation(async (model) => (
      model === "Pro" ? ["ag/gemini-3.1-pro-high", "commandcode/claude-opus-4-7"] : null
    ));
    getModelInfo.mockImplementation(async (model) => {
      if (model === "ag/gemini-3.1-pro-high") {
        return { provider: "antigravity", model: "gemini-3.1-pro-high" };
      }
      if (model === "commandcode/claude-opus-4-7") {
        return { provider: "commandcode", model: "claude-opus-4-7" };
      }
      return { provider: null, model };
    });
    getProviderConnections.mockImplementation(async ({ provider }) => {
      if (provider === "antigravity") {
        return [{
          id: "ag-locked",
          provider,
          isActive: true,
          authType: "oauth",
          name: "locked@example.com",
          accessToken: "ag-token",
          providerSpecificData: {},
          errorCode: 429,
          lastError: "quota exhausted",
          "modelLock_gemini-3.1-pro-high": new Date(Date.now() + 60_000).toISOString(),
        }];
      }
      if (provider === "commandcode") {
        return [{
          id: "cc-ok",
          provider,
          isActive: true,
          authType: "oauth",
          name: "cc@example.com",
          accessToken: "cc-token",
          providerSpecificData: {},
        }];
      }
      return [];
    });
    checkAndRefreshToken.mockImplementation(async (_provider, creds) => creds);
    handleChatCore.mockResolvedValue({
      success: true,
      response: new Response(JSON.stringify({ ok: true }), { status: 200 }),
    });
  });

  it("skips locked combo models before dispatching to chat core", async () => {
    const response = await handleChat(makeRequest("Pro"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(handleChatCore).toHaveBeenCalledTimes(1);
    expect(handleChatCore.mock.calls[0][0].modelInfo).toEqual({
      provider: "commandcode",
      model: "claude-opus-4-7",
    });
  });
});
