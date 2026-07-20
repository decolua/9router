import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkAndRefreshToken: vi.fn(),
  getProjectIdForConnection: vi.fn(),
  getProviderCredentials: vi.fn(),
  handleChatCore: vi.fn(),
  resolveRefreshProxyOptions: vi.fn(),
  updateProviderCredentials: vi.fn(),
}));

vi.mock("open-sse/index.js", () => ({}));
vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  extractApiKey: vi.fn(() => null),
  isValidApiKey: vi.fn(),
}));
vi.mock("open-sse/utils/claudeHeaderCache.js", () => ({ cacheClaudeHeaders: vi.fn() }));
vi.mock("../../src/lib/localDb.js", () => ({ getSettings: vi.fn(async () => ({})) }));
vi.mock("../../src/sse/services/model.js", () => ({
  getModelInfo: vi.fn(async () => ({ provider: "gemini-cli", model: "gemini-2.5-pro" })),
  getComboModels: vi.fn(async () => null),
}));
vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: mocks.handleChatCore }));
vi.mock("../../src/lib/headroom/detect.js", () => ({ DEFAULT_HEADROOM_URL: "http://localhost" }));
vi.mock("../../src/lib/pxpipe/loader.js", () => ({ getTransform: vi.fn() }));
vi.mock("../../src/lib/pxpipe/events.js", () => ({ appendPxpipeEvent: vi.fn() }));
vi.mock("open-sse/utils/error.js", () => ({
  errorResponse: vi.fn((status, message) => Response.json({ message }, { status })),
  unavailableResponse: vi.fn((status, message) => Response.json({ message }, { status })),
}));
vi.mock("open-sse/services/combo.js", () => ({ handleComboChat: vi.fn(), handleFusionChat: vi.fn() }));
vi.mock("open-sse/utils/bypassHandler.js", () => ({ handleBypassRequest: vi.fn(() => null) }));
vi.mock("open-sse/config/runtimeConfig.js", () => ({
  HTTP_STATUS: { BAD_REQUEST: 400, UNAUTHORIZED: 401, NOT_FOUND: 404, SERVICE_UNAVAILABLE: 503 },
}));
vi.mock("open-sse/translator/formats.js", () => ({ detectFormatByEndpoint: vi.fn() }));
vi.mock("../../src/sse/utils/logger.js", () => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  line: vi.fn(),
  maskKey: vi.fn(),
  warn: vi.fn(),
}));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: mocks.checkAndRefreshToken,
  resolveRefreshProxyOptions: mocks.resolveRefreshProxyOptions,
  updateProviderCredentials: mocks.updateProviderCredentials,
}));
vi.mock("open-sse/services/projectId.js", () => ({
  getProjectIdForConnection: mocks.getProjectIdForConnection,
}));

import { handleChat } from "../../src/sse/handlers/chat.js";

const proxyRoute = {
  source: "pool",
  proxyPoolId: "gemini-pool",
  connectionProxyEnabled: true,
  connectionProxyUrl: "http://proxy.test:8080",
  strictProxy: true,
  disableEnvProxy: true,
};

describe("chat project ID proxy routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const credentials = {
      connectionId: "gemini-connection",
      accessToken: "access-token",
      projectId: null,
      providerSpecificData: { proxyPoolId: "gemini-pool" },
    };
    mocks.getProviderCredentials.mockResolvedValue(credentials);
    mocks.resolveRefreshProxyOptions.mockReturnValue(proxyRoute);
    mocks.checkAndRefreshToken.mockResolvedValue({ ...credentials });
    mocks.getProjectIdForConnection.mockResolvedValue("project-id");
    mocks.updateProviderCredentials.mockResolvedValue(true);
    mocks.handleChatCore.mockResolvedValue({ success: true, response: Response.json({ ok: true }) });
  });

  it("passes normalized route through refresh and cold project discovery", async () => {
    const response = await handleChat(new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gemini-cli/gemini-2.5-pro", messages: [] }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.resolveRefreshProxyOptions).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: "gemini-connection",
    }));
    expect(mocks.checkAndRefreshToken).toHaveBeenCalledWith(
      "gemini-cli",
      expect.any(Object),
      proxyRoute,
    );
    expect(mocks.getProjectIdForConnection).toHaveBeenCalledWith(
      "gemini-connection",
      "access-token",
      proxyRoute,
    );
  });
});
