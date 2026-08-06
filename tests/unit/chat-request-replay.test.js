import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  clearAccountError: vi.fn(),
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  resolveClientApiKey: vi.fn(async () => ({ apiKey: null, valid: true })),
}));
const dispatchMocks = vi.hoisted(() => ({ handleChatCore: vi.fn() }));
const modelMocks = vi.hoisted(() => ({ getComboModels: vi.fn(), getModelInfo: vi.fn() }));
const settingsMocks = vi.hoisted(() => ({ getSettings: vi.fn() }));
const logMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  maskKey: vi.fn(() => "***"),
  warn: vi.fn(),
}));

vi.mock("@/sse/services/auth.js", () => ({
  clearAccountError: authMocks.clearAccountError,
  extractApiKey: () => null,
  getProviderCredentials: authMocks.getProviderCredentials,
  markAccountUnavailable: authMocks.markAccountUnavailable,
  resolveClientApiKey: authMocks.resolveClientApiKey,
}));
vi.mock("open-sse/handlers/chatCore.js", () => dispatchMocks);
vi.mock("open-sse/services/combo.js", () => ({
  detectRequiredCapabilities: vi.fn(() => []),
  handleComboChat: vi.fn(),
  handleFusionChat: vi.fn(),
}));
vi.mock("@/sse/services/model.js", () => modelMocks);
vi.mock("@/lib/localDb", () => settingsMocks);
vi.mock("@/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: vi.fn(async (_provider, credentials) => credentials),
  updateProviderCredentials: vi.fn(),
}));
vi.mock("@/sse/utils/logger.js", () => logMocks);

let handleChat;

function credentials(connectionId) {
  return {
    connectionId,
    connectionName: connectionId,
    apiKey: "provider-key",
    providerSpecificData: {},
  };
}

function failure() {
  const error = "[507]: exceeded request buffer limit while retrying upstream";
  return {
    success: false,
    status: 507,
    error,
    response: Response.json({ error: { message: error } }, { status: 507 }),
  };
}

function success() {
  return {
    success: true,
    response: Response.json({ choices: [{ message: { role: "assistant", content: "ok" } }] }),
  };
}

function request(model = "codex/gpt-5.6-sol") {
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "hello" }],
    }),
  });
}

beforeAll(async () => {
  ({ handleChat } = await import("../../src/sse/handlers/chat.js"));
});

beforeEach(() => {
  vi.clearAllMocks();
  settingsMocks.getSettings.mockResolvedValue({
    requireApiKey: false,
    providerThinking: {},
    cavemanEnabled: false,
    ponytailEnabled: false,
    ccFilterNaming: false,
  });
  modelMocks.getComboModels.mockResolvedValue(null);
  modelMocks.getModelInfo.mockResolvedValue({ provider: "codex", model: "gpt-5.6-sol" });
  authMocks.getProviderCredentials.mockResolvedValue(credentials("account-a"));
  authMocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: false, cooldownMs: 0 });
});

describe("chat request replay", () => {
  it("replays once on the same account before returning success", async () => {
    let attempts = 0;
    dispatchMocks.handleChatCore.mockImplementation(() => {
      attempts += 1;
      return attempts === 1 ? failure() : success();
    });

    const response = await handleChat(request());

    expect(response.status).toBe(200);
    expect(authMocks.getProviderCredentials).toHaveBeenNthCalledWith(
      2,
      "codex",
      expect.any(Set),
      "gpt-5.6-sol",
      { preferredConnectionId: "account-a" },
    );
    expect(dispatchMocks.handleChatCore.mock.calls.map(([options]) => options.connectionId))
      .toEqual(["account-a", "account-a"]);
    expect(authMocks.markAccountUnavailable).not.toHaveBeenCalled();
  });

  it("returns a repeated overflow without looping", async () => {
    dispatchMocks.handleChatCore.mockImplementation(() => failure());

    const response = await handleChat(request());

    expect(response.status).toBe(507);
    expect(dispatchMocks.handleChatCore).toHaveBeenCalledTimes(2);
    expect(authMocks.markAccountUnavailable).toHaveBeenCalledTimes(1);
  });

  it("uses a connection default model for upstream routing and account state", async () => {
    modelMocks.getModelInfo.mockResolvedValue({ provider: "codex", model: "auto" });
    authMocks.getProviderCredentials.mockResolvedValue({
      ...credentials("account-a"),
      defaultModel: "gpt-5.6-sol",
    });
    dispatchMocks.handleChatCore.mockImplementation(async (options) => {
      await options.onRequestSuccess();
      return success();
    });

    const response = await handleChat(request("auto"));

    expect(dispatchMocks.handleChatCore).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({ model: "codex/gpt-5.6-sol" }),
      modelInfo: { provider: "codex", model: "gpt-5.6-sol" },
    }));
    expect(authMocks.clearAccountError).toHaveBeenCalledWith(
      "account-a",
      expect.any(Object),
      "gpt-5.6-sol",
    );
    expect(response.headers.get("X-9Router-Resolved-Model")).toBe("gpt-5.6-sol");
  });
});
