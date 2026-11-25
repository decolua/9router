// The chat handler hands the client request's abort signal to chatCore, so an
// upstream the client no longer waits for is cancelled (and a stream held before
// commit stops reading).
import { describe, it, expect, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderCredentials: vi.fn(),
  handleChatCore: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: async () => ({ requireApiKey: false }),
  getModelAliases: async () => ({}),
  getComboByName: async () => null,
  getProviderNodes: async () => [],
  getCombos: async () => [],
  getProviderConnections: async () => [],
  getProviderConnectionById: async () => null,
  getCustomModels: async () => [],
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: async () => ({}) }));
vi.mock("@/lib/db/repos/combosRepo.js", () => ({ getCombos: async () => [] }));
vi.mock("@/lib/db/repos/apiKeysRepo.js", () => ({ getApiKeyByKey: async () => null }));
vi.mock("@/lib/usageDb.js", () => ({ saveRequestUsage: vi.fn() }));
vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: vi.fn(async () => ({ shouldFallback: false })),
  clearAccountError: vi.fn(),
  extractApiKey: () => null,
  isValidApiKey: async () => true,
}));
vi.mock("@/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: async (_p, c) => c,
  updateProviderCredentials: vi.fn(),
}));
vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: mocks.handleChatCore }));

const { handleChat } = await import("../../src/sse/handlers/chat.js");

describe("chat request signal", () => {
  it("passes the client request signal into chatCore", async () => {
    mocks.getProviderCredentials.mockResolvedValue({ connectionId: "conn-1", connectionName: "one" });
    mocks.handleChatCore.mockResolvedValue({ success: true, response: new Response("ok") });

    const request = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai/model-a", messages: [{ role: "user", content: "hi" }] }),
      signal: new AbortController().signal,
    });
    await handleChat(request);

    expect(mocks.handleChatCore).toHaveBeenCalledTimes(1);
    expect(mocks.handleChatCore.mock.calls[0][0].requestSignal).toBe(request.signal);
  });
});
