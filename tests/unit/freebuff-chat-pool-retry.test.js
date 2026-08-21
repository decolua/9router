import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  getProxyPoolById: vi.fn(),
  getModelInfo: vi.fn(),
  handleChatCore: vi.fn(),
  checkAndRefreshToken: vi.fn(async (_provider, credentials) => credentials),
  markAccountUnavailable: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getSettings: mocks.getSettings,
  updateProviderConnection: vi.fn(),
  getProxyPools: vi.fn(),
  validateApiKey: vi.fn(),
  getApiKeyMetadata: vi.fn(),
  touchApiKey: vi.fn(),
}));
vi.mock("@/models", () => ({ getProxyPoolById: mocks.getProxyPoolById }));
vi.mock("../../src/sse/services/model.js", () => ({ getModelInfo: mocks.getModelInfo, getComboModels: vi.fn() }));
vi.mock("../../src/sse/services/auth.js", async (importOriginal) => ({
  ...(await importOriginal()),
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: vi.fn(),
  extractApiKey: vi.fn(),
  isValidApiKey: vi.fn(),
  getApiKeyPolicyError: vi.fn(),
}));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({ updateProviderCredentials: vi.fn(), checkAndRefreshToken: mocks.checkAndRefreshToken }));
vi.mock("../../open-sse/handlers/chatCore.js", () => ({ handleChatCore: mocks.handleChatCore }));
vi.mock("../../open-sse/services/combo.js", () => ({ handleComboChat: vi.fn(), handleFusionChat: vi.fn(), detectRequiredCapabilities: vi.fn(() => new Set()) }));
vi.mock("../../open-sse/services/capacityAdapter.js", () => ({ augmentModelsWithCapacityAdapter: vi.fn((models) => models), withCapacityAdapterStripping: vi.fn((handler) => handler), getActiveAdapterStrategy: vi.fn() }));
vi.mock("@/lib/pxpipe/loader.js", () => ({ getTransform: vi.fn() }));
vi.mock("@/lib/pxpipe/events.js", () => ({ appendPxpipeEvent: vi.fn() }));

const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
const { handleChat } = await import("../../src/sse/handlers/chat.js");

function connection(proxyPoolId, proxyPoolIds = []) {
  return {
    id: "connection-a",
    provider: "freebuff",
    isActive: true,
    name: "Freebuff",
    accessToken: "test",
    priority: 1,
    providerSpecificData: { proxyPoolId, proxyPoolIds },
  };
}

function pool(id) {
  return { id, isActive: true, proxyUrl: `http://${id}.test`, noProxy: "", type: "http", strictProxy: true };
}

describe("Freebuff proxy-pool retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireApiKey: false, providerStrategies: {}, fallbackStrategy: "fill-first" });
    mocks.getModelInfo.mockResolvedValue({ provider: "freebuff", model: "model-a" });
    mocks.getProxyPoolById.mockImplementation(async (id) => pool(id));
  });

  it("returns strict no-fit credentials when a real single-pool assignment is excluded", async () => {
    mocks.getProviderConnections.mockResolvedValue([connection("pool-a")]);

    const initial = await getProviderCredentials("freebuff", null, "model-a");
    const excluded = await getProviderCredentials("freebuff", null, "model-a", { excludePoolIds: new Set(["pool-a"]) });

    expect(initial.providerSpecificData.proxyPoolId).toBe("pool-a");
    expect(excluded.providerSpecificData).toMatchObject({ proxyPoolId: null, noFitPool: true, strictProxy: true });
  });

  it("stops after a single assigned pool becomes excluded without marking the account unavailable", async () => {
    mocks.getProviderConnections.mockResolvedValue([connection("pool-a")]);
    mocks.handleChatCore.mockResolvedValueOnce({ success: false, status: 409, error: "limited", poolScoped: { poolId: "pool-a", reason: "limited_ip" } });

    const response = await handleChat(new Request("http://router.test/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "freebuff/model-a", messages: [{ role: "user", content: "hello" }] }),
    }));

    expect(response.status).toBe(503);
    expect(mocks.handleChatCore).toHaveBeenCalledTimes(1);
    expect(mocks.markAccountUnavailable).not.toHaveBeenCalled();
  });

  it("retries through an eligible real alternate pool without marking the account unavailable", async () => {
    mocks.getProviderConnections.mockResolvedValue([connection("", ["pool-a", "pool-b"])]);
    mocks.handleChatCore
      .mockResolvedValueOnce({ success: false, status: 409, error: "limited", poolScoped: { poolId: "pool-a", reason: "limited_ip" } })
      .mockResolvedValueOnce({ success: true, response: new Response("ok") });

    const response = await handleChat(new Request("http://router.test/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "freebuff/model-a", messages: [{ role: "user", content: "hello" }] }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.handleChatCore.mock.calls.map(([options]) => options.credentials.providerSpecificData.proxyPoolId)).toEqual(["pool-a", "pool-b"]);
    expect(mocks.markAccountUnavailable).not.toHaveBeenCalled();
  });

  it("returns bounded pool exhaustion without marking the Freebuff account unavailable", async () => {
    mocks.getProviderConnections.mockResolvedValue([connection("", ["pool-a", "pool-b", "pool-c"])]);
    mocks.handleChatCore
      .mockResolvedValueOnce({ success: false, status: 409, error: "limited-a", poolScoped: { poolId: "pool-a", reason: "limited_ip" }, response: new Response("limited-a", { status: 409 }) })
      .mockResolvedValueOnce({ success: false, status: 409, error: "limited-b", poolScoped: { poolId: "pool-b", reason: "limited_ip" }, response: new Response("limited-b", { status: 409 }) })
      .mockResolvedValueOnce({ success: false, status: 409, error: "limited-c", poolScoped: { poolId: "pool-c", reason: "limited_ip" }, response: new Response("limited-c", { status: 409 }) });

    const response = await handleChat(new Request("http://router.test/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "freebuff/model-a", messages: [{ role: "user", content: "hello" }] }),
    }));

    expect(response.status).toBe(409);
    expect(mocks.handleChatCore.mock.calls.map(([options]) => options.credentials.providerSpecificData.proxyPoolId)).toEqual(["pool-a", "pool-b", "pool-c"]);
    expect(mocks.markAccountUnavailable).not.toHaveBeenCalled();
  });
});
