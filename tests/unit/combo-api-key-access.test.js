import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderCredentials: vi.fn(),
  isApiKeyModelAllowed: vi.fn(),
  getSettings: vi.fn(),
  getComboModels: vi.fn(),
  getModelInfo: vi.fn(),
  handleChatCore: vi.fn(),
}));

vi.mock("open-sse/index.js", () => ({}));
vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  extractApiKey: (request) => request.headers.get("x-api-key"),
  isValidApiKey: vi.fn().mockResolvedValue(true),
  isApiKeyModelAllowed: mocks.isApiKeyModelAllowed,
}));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings }));
vi.mock("@/sse/services/model.js", () => ({
  getComboModels: mocks.getComboModels,
  getModelInfo: mocks.getModelInfo,
}));
vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: mocks.handleChatCore }));
vi.mock("open-sse/services/combo.js", () => ({
  detectRequiredCapabilities: () => new Set(),
  handleComboChat: ({ body, models, handleSingleModel }) => handleSingleModel(body, models[0]),
  handleFusionChat: vi.fn(),
}));
vi.mock("open-sse/services/capacityAdapter.js", () => ({
  augmentModelsWithCapacityAdapter: (models) => models,
  withCapacityAdapterStripping: (handler) => handler,
  getActiveAdapterStrategy: () => "fallback",
}));
vi.mock("open-sse/utils/bypassHandler.js", () => ({ handleBypassRequest: () => null }));
vi.mock("@/sse/services/tokenRefresh.js", () => ({
  updateProviderCredentials: vi.fn(),
  checkAndRefreshToken: vi.fn(async (_provider, credentials) => credentials),
}));
vi.mock("open-sse/services/projectId.js", () => ({ getProjectIdForConnection: vi.fn() }));
vi.mock("@/lib/pxpipe/loader.js", () => ({ getTransform: vi.fn() }));
vi.mock("@/lib/pxpipe/events.js", () => ({ appendPxpipeEvent: vi.fn() }));
vi.mock("@/sse/utils/logger.js", () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  maskKey: () => "masked",
}));

const { handleChat } = await import("@/sse/handlers/chat.js");

describe("combo API key access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireApiKey: true, comboStrategy: "fallback" });
    mocks.getComboModels.mockImplementation(async (model) =>
      model === "deepseek" ? ["ds/deepseek-v4-flash"] : null
    );
    mocks.getModelInfo.mockImplementation(async (model) =>
      model === "deepseek"
        ? { provider: null, model }
        : { provider: "deepseek", model: "deepseek-v4-flash" }
    );
    mocks.isApiKeyModelAllowed.mockImplementation(async (_apiKey, model, comboName) => {
      if (comboName === "deepseek") return { allowed: true };
      return { allowed: false, reason: `API key is not allowed to use model: ${model}` };
    });
    mocks.getProviderCredentials.mockResolvedValue({
      connectionId: "deepseek-connection",
      connectionName: "DeepSeek",
      apiKey: "upstream-key",
    });
    mocks.handleChatCore.mockResolvedValue({
      success: true,
      response: Response.json({ ok: true }),
    });
  });

  it("does not recheck combo members as directly requested models", async () => {
    const request = new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "combo-key" },
      body: JSON.stringify({
        model: "deepseek",
        max_tokens: 16,
        messages: [{ role: "user", content: "Reply with OK only." }],
      }),
    });

    const response = await handleChat(request);

    expect(response.status).toBe(200);
    expect(mocks.isApiKeyModelAllowed).toHaveBeenCalledTimes(1);
    expect(mocks.isApiKeyModelAllowed).toHaveBeenCalledWith("combo-key", null, "deepseek");
    expect(mocks.handleChatCore).toHaveBeenCalledWith(expect.objectContaining({
      modelInfo: { provider: "deepseek", model: "deepseek-v4-flash" },
      apiKey: "combo-key",
    }));
  });

  it("still rejects the same member when requested directly", async () => {
    const request = new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "combo-key" },
      body: JSON.stringify({
        model: "ds/deepseek-v4-flash",
        max_tokens: 16,
        messages: [{ role: "user", content: "Reply with OK only." }],
      }),
    });

    const response = await handleChat(request);

    expect(response.status).toBe(403);
    expect(mocks.isApiKeyModelAllowed).toHaveBeenCalledWith("combo-key", "ds/deepseek-v4-flash");
    expect(mocks.handleChatCore).not.toHaveBeenCalled();
  });

  it("authorizes a mapped route as a model instead of a combo", async () => {
    mocks.getComboModels.mockImplementation(async (model) =>
      model === "auto" ? ["lr/auto"] : null
    );
    mocks.getModelInfo.mockImplementation(async (model) =>
      model === "auto" || model === "lr/auto"
        ? { provider: "llmrouter", model: "auto" }
        : { provider: null, model }
    );
    mocks.isApiKeyModelAllowed.mockImplementation(async (_apiKey, model, comboName) => {
      if (model === "auto" && !comboName) return { allowed: true };
      return { allowed: false, reason: `Unexpected access check: ${model || comboName}` };
    });

    const request = new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "combo-key" },
      body: JSON.stringify({
        model: "auto",
        max_tokens: 16,
        messages: [{ role: "user", content: "Reply with OK only." }],
      }),
    });

    const response = await handleChat(request);

    expect(response.status).toBe(200);
    expect(mocks.isApiKeyModelAllowed).toHaveBeenCalledTimes(1);
    expect(mocks.isApiKeyModelAllowed).toHaveBeenCalledWith("combo-key", "auto");
    expect(mocks.handleChatCore).toHaveBeenCalledWith(expect.objectContaining({
      modelInfo: { provider: "llmrouter", model: "auto" },
      requestedModelOverride: "auto",
    }));
  });

  it("returns invalid model for an unresolved bare name without combo authorization", async () => {
    mocks.getComboModels.mockResolvedValue(null);
    mocks.getModelInfo.mockResolvedValue({ provider: null, model: "unknown-model" });
    mocks.isApiKeyModelAllowed.mockResolvedValue({ allowed: true });

    const request = new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "combo-key" },
      body: JSON.stringify({
        model: "unknown-model",
        max_tokens: 16,
        messages: [{ role: "user", content: "Reply with OK only." }],
      }),
    });

    const response = await handleChat(request);

    expect(response.status).toBe(400);
    expect(mocks.isApiKeyModelAllowed).toHaveBeenCalledTimes(1);
    expect(mocks.isApiKeyModelAllowed).toHaveBeenCalledWith("combo-key", "unknown-model");
    expect(mocks.handleChatCore).not.toHaveBeenCalled();
  });
});
