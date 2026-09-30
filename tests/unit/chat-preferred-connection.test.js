import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderCredentials: vi.fn(),
  getSettings: vi.fn(),
  getModelInfo: vi.fn(),
  getComboModels: vi.fn(),
  handleChatCore: vi.fn(),
  checkAndRefreshToken: vi.fn(),
}));

vi.mock("open-sse/index.js", () => ({}));
vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  extractApiKey: vi.fn(() => null),
  isValidApiKey: vi.fn(),
  validateApiKeyWithRules: vi.fn(),
}));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings }));
vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: mocks.getModelInfo,
  getComboModels: mocks.getComboModels,
}));
vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: mocks.handleChatCore }));
vi.mock("@/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: mocks.checkAndRefreshToken,
  updateProviderCredentials: vi.fn(),
}));
vi.mock("@/sse/services/antigravityQuota.js", () => ({
  handleAntigravityQuotaError: vi.fn(),
  clearAntigravityStrikes: vi.fn(),
}));
vi.mock("@/sse/utils/logger.js", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  maskKey: vi.fn(() => "masked"),
}));
vi.mock("@/lib/pxpipe/loader.js", () => ({ getTransform: vi.fn() }));
vi.mock("@/lib/pxpipe/events.js", () => ({ appendPxpipeEvent: vi.fn() }));
vi.mock("open-sse/services/projectId.js", () => ({ getProjectIdForConnection: vi.fn() }));
vi.mock("open-sse/services/capacityAdapter.js", () => ({
  augmentModelsWithCapacityAdapter: vi.fn((models) => models),
  withCapacityAdapterStripping: vi.fn((handler) => handler),
  getActiveAdapterStrategy: vi.fn(),
}));
vi.mock("open-sse/services/combo.js", () => ({
  handleComboChat: vi.fn(),
  handleFusionChat: vi.fn(),
  detectRequiredCapabilities: vi.fn(() => new Set()),
}));
vi.mock("open-sse/utils/bypassHandler.js", () => ({ handleBypassRequest: vi.fn(() => null) }));

import { handleChat } from "@/sse/handlers/chat.js";

describe("chat preferred connection routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireApiKey: false });
    mocks.getComboModels.mockResolvedValue(null);
    mocks.getModelInfo.mockResolvedValue({ provider: "openai", model: "gpt-4o" });
    mocks.getProviderCredentials.mockResolvedValue({
      connectionId: "connection-2",
      connectionName: "Test connection",
    });
    mocks.checkAndRefreshToken.mockImplementation(async (_provider, credentials) => credentials);
    mocks.handleChatCore.mockResolvedValue({ success: true, response: new Response("ok") });
  });

  it("maps x-connection-id to preferredConnectionId", async () => {
    const request = new Request("http://localhost/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-connection-id": "connection-2",
      },
      body: JSON.stringify({ model: "openai/gpt-4o", messages: [] }),
    });

    await handleChat(request);

    expect(mocks.getProviderCredentials).toHaveBeenCalledWith(
      "openai",
      expect.any(Set),
      "gpt-4o",
      { preferredConnectionId: "connection-2" }
    );
  });

  it("preserves normal credential selection without x-connection-id", async () => {
    const request = new Request("http://localhost/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai/gpt-4o", messages: [] }),
    });

    await handleChat(request);

    expect(mocks.getProviderCredentials).toHaveBeenCalledWith(
      "openai",
      expect.any(Set),
      "gpt-4o",
      { preferredConnectionId: null }
    );
  });
});
