import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  clearAccountError: vi.fn(),
  getProviderCredentials: vi.fn(),
  isValidApiKey: vi.fn(),
  markAccountUnavailable: vi.fn(),
}));
const comboMocks = vi.hoisted(() => ({ handleComboChat: vi.fn(), handleFusionChat: vi.fn(), detectRequiredCapabilities: vi.fn(() => new Set()) }));
const dispatchMocks = vi.hoisted(() => ({ handleChatCore: vi.fn() }));
const modelMocks = vi.hoisted(() => ({ getComboModels: vi.fn(), getModelInfo: vi.fn() }));
const settingsMocks = vi.hoisted(() => ({ getSettings: vi.fn() }));
const logMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  maskKey: vi.fn(() => "***"),
  warn: vi.fn(),
}));
const tokenMocks = vi.hoisted(() => ({
  checkAndRefreshToken: vi.fn(),
  updateProviderCredentials: vi.fn(),
}));

vi.mock("@/sse/services/auth.js", () => ({
  clearAccountError: authMocks.clearAccountError,
  extractApiKey: (request) => request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null,
  getProviderCredentials: authMocks.getProviderCredentials,
  isValidApiKey: authMocks.isValidApiKey,
  markAccountUnavailable: authMocks.markAccountUnavailable,
}));
vi.mock("open-sse/services/combo.js", () => comboMocks);
vi.mock("open-sse/services/capacityAdapter.js", () => ({
  augmentModelsWithCapacityAdapter: (models) => models,
  withCapacityAdapterStripping: (fn) => fn,
  getActiveAdapterStrategy: () => "fallback",
}));
vi.mock("open-sse/handlers/chatCore.js", () => dispatchMocks);
vi.mock("@/sse/services/model.js", () => modelMocks);
vi.mock("@/lib/localDb", () => settingsMocks);
vi.mock("@/sse/services/tokenRefresh.js", () => tokenMocks);
vi.mock("@/sse/utils/logger.js", () => logMocks);

let clearCacheAffinity;
let handleChat;

function credentials(connectionId) {
  return {
    connectionId,
    connectionName: connectionId,
    apiKey: "provider-key",
    providerSpecificData: {},
  };
}

function success() {
  return {
    success: true,
    response: Response.json({ choices: [{ message: { role: "assistant", content: "ok" } }] }),
  };
}

function failure(status = 503, error = "Selected model is at capacity") {
  return {
    success: false,
    status,
    error,
    response: Response.json({ error: { message: error } }, { status }),
  };
}

async function terminalSuccess(options) {
  await options.onRequestSuccess?.();
  return success();
}

function request({
  session = "session-1",
  client = "client-1",
  model = "codex/gpt-5.6-sol",
  apiKey = "key-1",
} = {}) {
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "x-9router-client-id": client,
      "x-session-id": session,
    },
    body: JSON.stringify({ model, messages: [{ role: "user", content: "hello" }], max_tokens: 8 }),
  });
}

function settings(cacheAffinityEnabled = true) {
  return {
    requireApiKey: true,
    providerStrategies: {
      codex: { fallbackStrategy: "round-robin", cacheAffinityEnabled },
    },
    providerThinking: {},
    cavemanEnabled: false,
    ponytailEnabled: false,
    ccFilterNaming: false,
  };
}

beforeAll(async () => {
  ({ clearCacheAffinity } = await import("../../src/sse/services/cacheAffinity.js"));
  ({ handleChat } = await import("../../src/sse/handlers/chat.js"));
});

beforeEach(() => {
  vi.clearAllMocks();
  clearCacheAffinity();
  settingsMocks.getSettings.mockResolvedValue(settings());
  authMocks.isValidApiKey.mockResolvedValue(true);
  authMocks.getProviderCredentials.mockResolvedValue(credentials("account-a"));
  authMocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: false, cooldownMs: 0 });
  authMocks.clearAccountError.mockResolvedValue(undefined);
  modelMocks.getComboModels.mockResolvedValue(null);
  modelMocks.getModelInfo.mockImplementation(async (model) => {
    const [provider, ...parts] = model.split("/");
    return { provider, model: parts.join("/") };
  });
  tokenMocks.checkAndRefreshToken.mockImplementation(async (_provider, value) => value);
  dispatchMocks.handleChatCore.mockImplementation(terminalSuccess);
});

describe("chat cache affinity", () => {
  it("uses strategy first, then prefers successful account for same scope", async () => {
    await handleChat(request());
    await handleChat(request());

    expect(authMocks.getProviderCredentials).toHaveBeenNthCalledWith(
      1,
      "codex",
      expect.any(Set),
      "gpt-5.6-sol",
    );
    expect(authMocks.getProviderCredentials).toHaveBeenNthCalledWith(
      2,
      "codex",
      expect.any(Set),
      "gpt-5.6-sol",
      { preferredConnectionId: "account-a" },
    );
    expect(logMocks.debug).toHaveBeenCalledWith(
      "CACHE_AFFINITY",
      "codex/gpt-5.6-sol | session | hit",
    );
    expect(JSON.stringify(logMocks.debug.mock.calls)).not.toMatch(/key-1|client-1|session-1|[a-f0-9]{64}/);
  });

  it("does not share affinity across session, model, client, or API key", async () => {
    await handleChat(request());
    await handleChat(request({ session: "session-2" }));
    await handleChat(request({ model: "codex/gpt-5.6-terra" }));
    await handleChat(request({ client: "client-2" }));
    await handleChat(request({ apiKey: "key-2" }));

    for (const call of authMocks.getProviderCredentials.mock.calls.slice(1)) {
      expect(call).toHaveLength(3);
    }
  });

  it("preserves fallback and repins successful replacement", async () => {
    await handleChat(request());
    authMocks.getProviderCredentials.mockReset()
      .mockResolvedValueOnce(credentials("account-a"))
      .mockResolvedValueOnce(credentials("account-b"));
    dispatchMocks.handleChatCore.mockReset()
      .mockResolvedValueOnce(failure())
      .mockImplementationOnce(terminalSuccess);
    authMocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: true, cooldownMs: 30_000 });

    await handleChat(request());
    authMocks.getProviderCredentials.mockReset().mockResolvedValue(credentials("account-b"));
    dispatchMocks.handleChatCore.mockReset().mockImplementation(terminalSuccess);
    await handleChat(request());

    expect(authMocks.getProviderCredentials).toHaveBeenCalledWith(
      "codex",
      expect.any(Set),
      "gpt-5.6-sol",
      { preferredConnectionId: "account-b" },
    );
    expect(logMocks.debug).toHaveBeenCalledWith(
      "CACHE_AFFINITY",
      "codex/gpt-5.6-sol | session | repin",
    );
  });

  it("does not consult or record affinity when provider setting is disabled", async () => {
    settingsMocks.getSettings.mockResolvedValue(settings(false));
    await handleChat(request());
    await handleChat(request());

    for (const call of authMocks.getProviderCredentials.mock.calls) {
      expect(call).toHaveLength(3);
    }
  });

  it("does not pin failed or unterminated requests", async () => {
    dispatchMocks.handleChatCore.mockResolvedValue(failure(400, "invalid request"));
    await handleChat(request());
    dispatchMocks.handleChatCore.mockResolvedValue(success());
    await handleChat(request());
    dispatchMocks.handleChatCore.mockImplementation(terminalSuccess);
    await handleChat(request());

    expect(authMocks.getProviderCredentials.mock.calls[1]).toHaveLength(3);
    expect(authMocks.getProviderCredentials.mock.calls[2]).toHaveLength(3);
  });

  it("propagates affinity identity through combo members", async () => {
    modelMocks.getComboModels.mockImplementation(async (model) => (
      model === "cache-combo" ? ["codex/gpt-5.6-sol"] : null
    ));
    comboMocks.handleComboChat.mockImplementation(({ body, models, handleSingleModel }) => (
      handleSingleModel({ ...body, model: models[0] }, models[0])
    ));

    await handleChat(request({ model: "cache-combo" }));
    await handleChat(request({ model: "cache-combo" }));

    expect(authMocks.getProviderCredentials).toHaveBeenNthCalledWith(
      2,
      "codex",
      expect.any(Set),
      "gpt-5.6-sol",
      { preferredConnectionId: "account-a" },
    );
  });
});
