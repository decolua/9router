import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  clearAccountError: vi.fn(),
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
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
  isValidApiKey: vi.fn(async () => true),
  markAccountUnavailable: authMocks.markAccountUnavailable,
}));
vi.mock("open-sse/handlers/chatCore.js", () => dispatchMocks);
vi.mock("open-sse/services/combo.js", () => ({
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

function request() {
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "codex/gpt-5.6-sol",
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
});
