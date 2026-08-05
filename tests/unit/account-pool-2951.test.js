import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  handleChatCore: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: mocks.clearAccountError,
  extractApiKey: vi.fn(() => null),
  isValidApiKey: vi.fn(),
}));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings }));
vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: vi.fn(async () => ({ provider: "nvidia", model: "test-model" })),
  getComboModels: vi.fn(async () => null),
}));
vi.mock("../../open-sse/handlers/chatCore.js", () => ({ handleChatCore: mocks.handleChatCore }));
vi.mock("@/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: vi.fn(async (_provider, credentials) => credentials),
  updateProviderCredentials: vi.fn(),
}));
vi.mock("@/sse/utils/logger.js", () => ({
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), maskKey: vi.fn(),
}));
vi.mock("@/lib/pxpipe/loader.js", () => ({ getTransform: vi.fn() }));
vi.mock("@/lib/pxpipe/events.js", () => ({ appendPxpipeEvent: vi.fn() }));
vi.mock("../../open-sse/utils/bypassHandler.js", () => ({ handleBypassRequest: vi.fn(() => null) }));

import { handleChat } from "../../src/sse/handlers/chat.js";

const request = () => new Request("http://localhost/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ model: "nvidia/test-model", messages: [{ role: "user", content: "hi" }] }),
});

describe("multi-key account routing (#2951)", () => {
  const keys = Array.from({ length: 8 }, (_, index) => ({
    connectionId: `key-${index + 1}`,
    connectionName: `Key ${index + 1}`,
    providerSpecificData: {},
  }));

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireApiKey: false });
    mocks.getProviderCredentials.mockImplementation(async (_provider, excluded) =>
      keys.find(key => !excluded.has(key.connectionId)) || null);
  });

  it.each([
    [400, "invalid_request_error"],
    [429, "MODEL_CAPACITY_EXHAUSTED"],
  ])("does not drain eight keys for %s %s", async (status, error) => {
    mocks.handleChatCore.mockResolvedValue({ success: false, status, error, response: new Response(error, { status }) });
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: false });

    const response = await handleChat(request());

    expect(response.status).toBe(status);
    expect(mocks.handleChatCore).toHaveBeenCalledOnce();
    expect(mocks.getProviderCredentials).toHaveBeenCalledOnce();
  });

  it("rotates only from an invalid key to the next successful key", async () => {
    mocks.handleChatCore
      .mockResolvedValueOnce({ success: false, status: 401, error: "invalid_api_key", response: new Response("bad", { status: 401 }) })
      .mockResolvedValueOnce({ success: true, response: new Response("ok") });
    mocks.markAccountUnavailable.mockResolvedValueOnce({ shouldFallback: true });

    const response = await handleChat(request());

    expect(response.status).toBe(200);
    expect(mocks.handleChatCore).toHaveBeenCalledTimes(2);
    expect(mocks.handleChatCore.mock.calls.map(([options]) => options.connectionId)).toEqual(["key-1", "key-2"]);
    expect(mocks.getProviderCredentials).toHaveBeenCalledTimes(2);
  });
});
