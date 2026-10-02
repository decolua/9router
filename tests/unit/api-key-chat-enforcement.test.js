import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(), getApiKeyByValue: vi.fn(), getModelInfo: vi.fn(),
  getProviderCredentials: vi.fn(), handleChatCore: vi.fn(), augment: vi.fn(),
}));

vi.mock("open-sse/index.js", () => ({}));
vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings, getApiKeyByValue: mocks.getApiKeyByValue,
}));
vi.mock("../../src/sse/services/auth.js", async () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  extractApiKey: (await import("../../src/lib/requestApiKey.js")).extractRequestApiKey,
  markAccountUnavailable: vi.fn(), clearAccountError: vi.fn(),
}));
vi.mock("../../src/sse/services/model.js", () => ({
  getModelInfo: mocks.getModelInfo, getComboModels: vi.fn(async () => null),
}));
vi.mock("../../src/sse/services/antigravityQuota.js", () => ({
  handleAntigravityQuotaError: vi.fn(), clearAntigravityStrikes: vi.fn(),
}));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  updateProviderCredentials: vi.fn(), checkAndRefreshToken: async (_, credentials) => credentials,
}));
vi.mock("../../src/sse/utils/logger.js", () => ({
  warn: vi.fn(), debug: vi.fn(), info: vi.fn(), maskKey: () => "masked",
}));
vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: mocks.handleChatCore }));
vi.mock("@/lib/headroom/detect", () => ({ DEFAULT_HEADROOM_URL: "http://localhost" }));
vi.mock("@/lib/pxpipe/loader.js", () => ({ getTransform: vi.fn() }));
vi.mock("@/lib/pxpipe/events.js", () => ({ appendPxpipeEvent: vi.fn() }));
vi.mock("open-sse/utils/error.js", () => ({
  errorResponse: (status, message) => Response.json({ error: { message } }, { status }),
  unavailableResponse: (status, message) => Response.json({ error: { message } }, { status }),
}));
vi.mock("open-sse/utils/upstreamHeaders.js", () => ({ upstreamResponseHeaders: () => ({}) }));
vi.mock("open-sse/services/combo.js", () => ({
  detectRequiredCapabilities: () => new Set(),
  // Simulate a capacity adapter selecting its alternative seat, not the
  // client-selected target. The real chat dispatch must check this leaf.
  handleComboChat: ({ body, models, handleSingleModel }) => handleSingleModel(body, models.at(-1)),
  handleFusionChat: vi.fn(),
}));
vi.mock("open-sse/services/capacityAdapter.js", () => ({
  augmentModelsWithCapacityAdapter: mocks.augment,
  withCapacityAdapterStripping: (callback) => callback,
  getActiveAdapterStrategy: () => "fallback",
}));
vi.mock("open-sse/utils/bypassHandler.js", () => ({ handleBypassRequest: () => null }));
vi.mock("open-sse/translator/formats.js", () => ({ detectFormatByEndpoint: () => "openai" }));
vi.mock("open-sse/services/projectId.js", () => ({ getProjectIdForConnection: vi.fn() }));

import { handleChat } from "../../src/sse/handlers/chat.js";

function request(body) {
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST", headers: { Authorization: "Bearer test-key", "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "Hello" }], ...body }),
  });
}

describe("chat API key enforcement at actual dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireApiKey: true });
    mocks.getApiKeyByValue.mockResolvedValue({ isActive: true, permissions: {} });
    mocks.getModelInfo.mockImplementation(async (route) => {
      const slash = route.indexOf("/");
      return { provider: route.slice(0, slash), model: route.slice(slash + 1) };
    });
    mocks.getProviderCredentials.mockResolvedValue({ connectionId: "connection", apiKey: "upstream-secret" });
    mocks.handleChatCore.mockImplementation(async () => ({ success: true, response: Response.json({ ok: true }) }));
    mocks.augment.mockImplementation((models) => models);
  });

  it("routes an omitted model to the configured forced model", async () => {
    mocks.getApiKeyByValue.mockResolvedValue({ isActive: true, permissions: { forceModel: "local/model-a" } });
    expect((await handleChat(request({}))).status).toBe(200);
    expect(mocks.getProviderCredentials).toHaveBeenCalledWith("local", expect.any(Set), "model-a", expect.any(Object));
    expect(mocks.handleChatCore.mock.calls[0][0].body.model).toBe("local/model-a");
  });

  it.each(["x-api-key", "x-goog-api-key", "query"])("retains forced routing for the %s key transport", async (transport) => {
    mocks.getSettings.mockResolvedValue({ requireApiKey: false });
    mocks.getApiKeyByValue.mockResolvedValue({ isActive: true, permissions: { forceModel: "local/model-a" } });
    const headers = { "Content-Type": "application/json" };
    if (transport !== "query") headers[transport] = "test-key";
    const req = new Request(`http://localhost/v1/chat/completions${transport === "query" ? "?key=test-key" : ""}`, {
      method: "POST", headers, body: JSON.stringify({ messages: [{ role: "user", content: "Hello" }] }),
    });
    expect((await handleChat(req)).status).toBe(200);
    expect(mocks.getApiKeyByValue).toHaveBeenCalledWith("test-key");
    expect(mocks.handleChatCore.mock.calls[0][0].body.model).toBe("local/model-a");
  });

  it("overrides a caller-supplied model before dispatch", async () => {
    mocks.getApiKeyByValue.mockResolvedValue({ isActive: true, permissions: { forceModel: "local/model-a" } });
    expect((await handleChat(request({ model: "other/model-b" }))).status).toBe(200);
    expect(mocks.handleChatCore.mock.calls[0][0].modelInfo).toEqual({ provider: "local", model: "model-a" });
  });

  it("denies disallowed providers before obtaining credentials", async () => {
    mocks.getApiKeyByValue.mockResolvedValue({ isActive: true, permissions: { providerIds: ["local"] } });
    expect((await handleChat(request({ model: "other/model-b" }))).status).toBe(403);
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
    expect(mocks.handleChatCore).not.toHaveBeenCalled();
  });

  it.each([
    { providerIds: ["local"] },
    { forceProviderId: "local" },
    { forceModel: "local/model-a" },
  ])("blocks a capacity-adapter escape for policy %j", async (permissions) => {
    mocks.getApiKeyByValue.mockResolvedValue({ isActive: true, permissions });
    mocks.augment.mockReturnValue(["local/model-a", "other/model-b"]);
    expect((await handleChat(request({ model: "local/model-a" }))).status).toBe(403);
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
    expect(mocks.handleChatCore).not.toHaveBeenCalled();
  });

  it("blocks same-provider model switching for an exact forced model", async () => {
    mocks.getApiKeyByValue.mockResolvedValue({ isActive: true, permissions: { forceModel: "local/model-a" } });
    mocks.augment.mockReturnValue(["local/model-a", "local/model-b"]);
    expect((await handleChat(request({ model: "local/model-a" }))).status).toBe(403);
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
  });

  it("rejects inactive keys before dispatch", async () => {
    mocks.getApiKeyByValue.mockResolvedValue({ isActive: false, permissions: {} });
    expect((await handleChat(request({ model: "local/model-a" }))).status).toBe(401);
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
    expect(mocks.handleChatCore).not.toHaveBeenCalled();
  });

  it("preserves unrestricted adapter routing for legacy keys", async () => {
    mocks.augment.mockReturnValue(["local/model-a", "other/model-b"]);
    expect((await handleChat(request({ model: "local/model-a" }))).status).toBe(200);
    expect(mocks.handleChatCore.mock.calls[0][0].modelInfo.provider).toBe("other");
  });
});
