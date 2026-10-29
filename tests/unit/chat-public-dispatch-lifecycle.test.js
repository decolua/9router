import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getModelInfo: vi.fn(),
  getComboModels: vi.fn(),
  getProviderCredentials: vi.fn(),
  getApiKeyMetadata: vi.fn(),
  getDailyUsageForApiKey: vi.fn(),
  touchApiKey: vi.fn(),
  clearAccountError: vi.fn(async () => {}),
  executor: { execute: vi.fn(), parseError: vi.fn(), noAuth: true },
  checkAndRefreshToken: vi.fn(async (_provider, credentials) => credentials),
  resolveConnectionProxyConfig: vi.fn(),
  getPxpipeTransform: vi.fn(),
}));

vi.mock("open-sse/index.js", () => ({}));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings, getApiKeyMetadata: mocks.getApiKeyMetadata, touchApiKey: mocks.touchApiKey }));
vi.mock("@/lib/db/repos/apiKeysRepo.js", () => ({
  getApiKeyByKey: async (key) => {
    const legacy = await mocks.getApiKeyMetadata(key);
    if (!legacy) return null;
    const allow = legacy.allowedModels || [];
    return { id: key, name: key, key, access: { restricted: allow.length > 0, allow }, expiresAt: legacy.expiresAt ?? null, maxRequestsPerDay: legacy.maxRequestsPerDay ?? null, maxSpendUsdPerDay: legacy.maxSpendUsdPerDay ?? null };
  },
  touchApiKey: mocks.touchApiKey,
}));
vi.mock("@/lib/db/repos/combosRepo.js", () => ({ getCombos: async () => [] }));
vi.mock("@/sse/services/model.js", () => ({ getModelInfo: mocks.getModelInfo, getComboModels: mocks.getComboModels }));
vi.mock("@/sse/services/auth.js", async (importOriginal) => ({ ...(await importOriginal()), getProviderCredentials: mocks.getProviderCredentials, markAccountUnavailable: vi.fn(async () => ({ shouldFallback: false })), clearAccountError: mocks.clearAccountError, extractApiKey: vi.fn((request) => request.headers.get("Authorization") ? "key" : null), isValidApiKey: vi.fn() }));
vi.mock("@/sse/services/tokenRefresh.js", () => ({ updateProviderCredentials: vi.fn(), checkAndRefreshToken: mocks.checkAndRefreshToken }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig }));
vi.mock("@/lib/usageDb.js", () => ({ trackPendingRequest: vi.fn(async () => {}), appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}) }));
vi.mock("@/lib/db/repos/usageRepo", () => ({ getDailyUsageForApiKey: mocks.getDailyUsageForApiKey }));
vi.mock("@/lib/pxpipe/loader.js", () => ({ getTransform: mocks.getPxpipeTransform }));
vi.mock("@/lib/pxpipe/events.js", () => ({ appendPxpipeEvent: vi.fn() }));
vi.mock("../../open-sse/translator/index.js", () => ({ translateRequest: vi.fn((_from, _to, _model, body) => ({ ...body })), translateResponse: vi.fn((_from, _to, chunk) => [chunk]), initState: vi.fn(() => ({})), needsTranslation: vi.fn(() => false), register: vi.fn() }));
vi.mock("../../open-sse/executors/index.js", () => ({ getExecutor: () => mocks.executor }));
vi.mock("../../open-sse/services/combo.js", () => ({ handleComboChat: vi.fn(), handleFusionChat: vi.fn(), detectRequiredCapabilities: vi.fn(() => new Set()) }));
vi.mock("../../open-sse/services/capacityAdapter.js", () => ({ augmentModelsWithCapacityAdapter: vi.fn((models) => models), withCapacityAdapterStripping: vi.fn((handler) => handler), getActiveAdapterStrategy: vi.fn() }));

const { handleChat } = await import("../../src/sse/handlers/chat.js");
const encoder = new TextEncoder();
const requestFor = (model = "groq/test", stream = false, headers = {}) => new Request("http://router.test/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ model, stream, messages: [{ role: "user", content: "hello" }] }) });
const credentials = (provider = "groq") => ({ connectionId: `${provider}-connection`, connectionName: provider, provider, accessToken: "test", providerSpecificData: {} });

describe("public chat dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireApiKey: false, ccFilterNaming: false, providerThinking: {}, providerStrategies: {} });
    mocks.getComboModels.mockResolvedValue(null);
    mocks.getModelInfo.mockImplementation(async (value) => { const [provider, model] = value.split("/"); return { provider, model }; });
    mocks.getProviderCredentials.mockImplementation(async (provider) => credentials(provider));
    mocks.resolveConnectionProxyConfig.mockResolvedValue({});
    mocks.getPxpipeTransform.mockResolvedValue(null);
    mocks.getApiKeyMetadata.mockResolvedValue(null);
    mocks.getDailyUsageForApiKey.mockResolvedValue({ requests: 0, cost: 0 });
  });

  it("denies a restricted API key before selecting credentials or dispatching", async () => {
    mocks.getApiKeyMetadata.mockResolvedValue({ allowedModels: ["kr/*"] });
    const response = await handleChat(requestFor("groq/test", false, { Authorization: "Bearer key" }));
    expect(response.status).toBe(403);
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
    expect(mocks.executor.execute).not.toHaveBeenCalled();
  });

  it("returns a successful non-streaming upstream response", async () => {
    mocks.executor.execute.mockResolvedValueOnce({ response: new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { headers: { "content-type": "application/json" } }), url: "https://upstream.invalid", headers: {}, transformedBody: {} });
    const response = await handleChat(requestFor());
    expect(response.status).toBe(200);
    expect(mocks.clearAccountError).toHaveBeenCalledOnce();
  });

  it("records account success after a streamed response reaches EOF", async () => {
    mocks.executor.execute.mockResolvedValueOnce({ response: new Response(new ReadableStream({ start(controller) { controller.enqueue(encoder.encode("data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\ndata: [DONE]\n\n")); controller.close(); } }), { headers: { "content-type": "text/event-stream" } }), url: "https://upstream.invalid", headers: {}, transformedBody: {} });
    const response = await handleChat(requestFor("groq/test", true));
    await response.text();
    await Promise.resolve();
    expect(mocks.clearAccountError).toHaveBeenCalledOnce();
  });

  it("does not record account success after a client cancels a live stream", async () => {
    mocks.executor.execute.mockResolvedValueOnce({ response: new Response(new ReadableStream({ start(controller) { controller.enqueue(encoder.encode("data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n")); } }), { headers: { "content-type": "text/event-stream" } }), url: "https://upstream.invalid", headers: {}, transformedBody: {} });
    const response = await handleChat(requestFor("groq/test", true));
    await response.body.cancel("client cancelled");
    await Promise.resolve();
    expect(mocks.clearAccountError).not.toHaveBeenCalled();
  });
});
