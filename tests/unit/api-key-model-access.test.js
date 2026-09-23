import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildModelCandidates, evaluateModelAccess, matchesPattern, normalizeModelAccess } from "../../src/sse/services/modelAccess.js";

const mocks = vi.hoisted(() => ({
  getApiKeyByKey: vi.fn(),
  getProviderNodes: vi.fn(),
  getSettings: vi.fn(),
  extractApiKey: vi.fn(),
  isValidApiKey: vi.fn(),
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  getModelInfo: vi.fn(),
  getComboModels: vi.fn(),
  handleChatCore: vi.fn(),
  checkAndRefreshToken: vi.fn(),
}));

vi.mock("@/lib/db/index.js", () => ({ getApiKeyByKey: mocks.getApiKeyByKey }));
vi.mock("@/lib/db/repos/nodesRepo.js", () => ({ getProviderNodes: mocks.getProviderNodes }));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings }));
vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: mocks.clearAccountError,
  extractApiKey: mocks.extractApiKey,
  isValidApiKey: mocks.isValidApiKey,
}));
vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: mocks.getModelInfo,
  getComboModels: mocks.getComboModels,
}));
vi.mock("open-sse/index.js", () => ({}));
vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: mocks.handleChatCore }));
vi.mock("open-sse/services/combo.js", () => ({
  handleComboChat: vi.fn(),
  handleFusionChat: vi.fn(),
  detectRequiredCapabilities: vi.fn(() => new Set()),
}));
vi.mock("open-sse/services/capacityAdapter.js", () => ({
  augmentModelsWithCapacityAdapter: vi.fn((models) => models),
  withCapacityAdapterStripping: vi.fn((handler) => handler),
  getActiveAdapterStrategy: vi.fn(),
}));
vi.mock("open-sse/utils/bypassHandler.js", () => ({ handleBypassRequest: vi.fn(() => null) }));
vi.mock("@/lib/headroom/detect", () => ({ DEFAULT_HEADROOM_URL: "https://headroom.test" }));
vi.mock("@/lib/pxpipe/loader.js", () => ({ getTransform: vi.fn() }));
vi.mock("@/lib/pxpipe/events.js", () => ({ appendPxpipeEvent: vi.fn() }));
vi.mock("@/sse/utils/logger.js", () => ({
  request: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), maskKey: vi.fn(() => "masked"),
}));
vi.mock("@/sse/services/tokenRefresh.js", () => ({
  updateProviderCredentials: vi.fn(),
  checkAndRefreshToken: mocks.checkAndRefreshToken,
}));
vi.mock("open-sse/services/projectId.js", () => ({ getProjectIdForConnection: vi.fn() }));
vi.mock("@/sse/services/antigravityQuota.js", () => ({
  handleAntigravityQuotaError: vi.fn(),
  clearAntigravityStrikes: vi.fn(),
}));

const { handleChat } = await import("../../src/sse/handlers/chat.js");

function chatRequest(model, apiKey = "client-key") {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify({ model, messages: [{ role: "user", content: "hello" }] }),
  });
}

describe("API key model access rules", () => {
  it("matches exact, case-insensitive, wildcard, and escaped glob patterns", () => {
    expect(matchesPattern("provider/model", "provider/model")).toBe(true);
    expect(matchesPattern("Provider/Model", "provider/model")).toBe(true);
    expect(matchesPattern("mgf/*", "mgf/zai-org/GLM-5.3-Flash")).toBe(true);
    expect(matchesPattern("*flash*", "mgf/model-FLASH-v2")).toBe(true);
    expect(matchesPattern("a.b", "axb")).toBe(false);
  });

  it("normalizes empty, JSON, invalid, and duplicate rule data", () => {
    expect(normalizeModelAccess(null)).toEqual({ mode: "all", patterns: [] });
    expect(normalizeModelAccess('{"mode":"deny","patterns":["mgf/*"]}')).toEqual({
      mode: "deny",
      patterns: ["mgf/*"],
    });
    expect(normalizeModelAccess({ mode: "invalid", patterns: ["model"] })).toEqual({ mode: "all", patterns: [] });
    expect(normalizeModelAccess({ mode: "allow", patterns: [" mgf/* ", "MGF/*", "", " cx/model "] })).toEqual({
      mode: "allow",
      patterns: ["mgf/*", "cx/model"],
    });
    expect(normalizeModelAccess({ mode: "deny", patterns: Array.from({ length: 205 }, (_, index) => `model-${index}`) }).patterns).toHaveLength(200);
  });

  it("builds candidates with provider-node prefixes and built-in aliases", async () => {
    mocks.getProviderNodes.mockResolvedValueOnce([
      { id: "custom", type: "openai-compatible", prefix: "custom-prefix" },
    ]);
    expect(await buildModelCandidates("user/custom-model", "custom", "custom-model")).toEqual([
      "user/custom-model",
      "custom/custom-model",
      "custom-prefix/custom-model",
    ]);
    mocks.getProviderNodes.mockResolvedValueOnce([]);
    expect(await buildModelCandidates("cx/gpt-5.6-sol", "codex", "gpt-5.6-sol")).toEqual([
      "cx/gpt-5.6-sol",
      "codex/gpt-5.6-sol",
    ]);
  });

  it("evaluates allow, deny, top-level, and unrestricted access", () => {
    expect(evaluateModelAccess({ mode: "deny", patterns: ["mgf/*"] }, ["mgf/model"])).toEqual({
      allowed: false,
      matched: "mgf/*",
    });
    expect(evaluateModelAccess({ mode: "deny", patterns: ["mgf/*"] }, ["cx/model"])).toEqual({ allowed: true });
    expect(evaluateModelAccess({ mode: "allow", patterns: ["mgf/*"] }, ["mgf/model"]).allowed).toBe(true);
    expect(evaluateModelAccess({ mode: "allow", patterns: ["mgf/*"] }, ["cx/model"]).allowed).toBe(false);
    expect(evaluateModelAccess({ mode: "allow", patterns: [] }, ["cx/model"], { topLevelAllowed: true }).allowed).toBe(true);
    expect(evaluateModelAccess({ mode: "all", patterns: [] }, ["cx/model"]).allowed).toBe(true);
  });

  describe("chat enforcement", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mocks.getSettings.mockResolvedValue({ requireApiKey: false });
      mocks.extractApiKey.mockImplementation((request) => {
        const authorization = request.headers.get("Authorization");
        return authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
      });
      mocks.getProviderNodes.mockResolvedValue([]);
      mocks.getComboModels.mockResolvedValue(null);
      mocks.getModelInfo.mockImplementation(async (value) => {
        const [provider, ...modelParts] = value.split("/");
        return { provider, model: modelParts.join("/") };
      });
      mocks.getApiKeyByKey.mockResolvedValue({
        id: "key-id",
        name: "Limited key",
        modelAccess: { mode: "deny", patterns: ["mgf/*"] },
      });
      mocks.getProviderCredentials.mockResolvedValue({ connectionId: "connection-id", connectionName: "Test" });
      mocks.checkAndRefreshToken.mockImplementation(async (_provider, credentials) => credentials);
      mocks.handleChatCore.mockResolvedValue({ success: true, response: Response.json({ ok: true }) });
    });

    it("returns 403 for a denied model before calling chatCore", async () => {
      const response = await handleChat(chatRequest("mgf/zai-org/GLM-5.3-Flash"));
      expect(response.status).toBe(403);
      expect(mocks.handleChatCore).not.toHaveBeenCalled();
    });

    it("blocks a plain alias after resolving its provider-node prefix", async () => {
      mocks.getModelInfo.mockResolvedValue({
        provider: "openai-compatible-chat-node1",
        model: "zai-org/GLM-5.3-Flash",
      });
      mocks.getProviderNodes.mockResolvedValue([
        { id: "openai-compatible-chat-node1", type: "openai-compatible", prefix: "mgf" },
      ]);

      const response = await handleChat(chatRequest("glm-flash"));

      expect(response.status).toBe(403);
      expect(mocks.handleChatCore).not.toHaveBeenCalled();
      expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
    });

    it("continues for a model that does not match a deny rule", async () => {
      const response = await handleChat(chatRequest("openai/gpt-4.1"));
      expect(response.status).toBe(200);
      expect(mocks.handleChatCore).toHaveBeenCalledTimes(1);
    });

    it("returns 403 when an allow rule does not match", async () => {
      mocks.getApiKeyByKey.mockResolvedValue({
        id: "key-id",
        name: "Allowlisted key",
        modelAccess: { mode: "allow", patterns: ["mgf/*"] },
      });
      const response = await handleChat(chatRequest("openai/gpt-4.1"));
      expect(response.status).toBe(403);
      expect(mocks.handleChatCore).not.toHaveBeenCalled();
    });

    it("continues without a key when Require API key is disabled", async () => {
      const response = await handleChat(chatRequest("openai/gpt-4.1", null));
      expect(response.status).toBe(200);
      expect(mocks.getApiKeyByKey).not.toHaveBeenCalled();
      expect(mocks.handleChatCore).toHaveBeenCalledTimes(1);
    });
  });
});
