import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  handleChatCore: vi.fn(),
}));

vi.mock("open-sse/index.js", () => ({}));
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
vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: vi.fn(),
  extractApiKey: () => null,
  isValidApiKey: async () => true,
}));
vi.mock("@/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: async (_provider, credentials) => credentials,
  updateProviderCredentials: vi.fn(),
}));
vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: mocks.handleChatCore }));

import { handleChat } from "../../src/sse/handlers/chat.js";

const chat = () => handleChat(new Request("http://localhost/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ model: "openai/gpt-4o", messages: [{ role: "user", content: "hi" }] }),
}));
const cooldown = (lastErrorCode) => ({
  allRateLimited: true,
  lastError: "cached provider error",
  lastErrorCode,
  retryAfter: new Date(Date.now() + 60000).toISOString(),
  retryAfterHuman: "reset after 60s",
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(1900000000000);
  mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: true, cooldownMs: 0 });
});
afterEach(() => vi.restoreAllMocks());

describe("cached upstream chat errors (#4663)", () => {
  it.each([429, "429", 502])("preserves cached upstream error status %j", async (status) => {
    mocks.getProviderCredentials.mockResolvedValue(cooldown(status));

    const response = await chat();

    expect(response.status).toBe(Number(status));
    expect(response.headers.get("retry-after")).toBe("60");
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({
      error: { message: "[openai/gpt-4o] cached provider error (reset after 60s)" },
    });
    expect(mocks.handleChatCore).not.toHaveBeenCalled();
  });

  it("prefers this request's upstream status and preserves retry guidance over a stale cached error", async () => {
    mocks.getProviderCredentials
      .mockResolvedValueOnce({ connectionId: "connection", connectionName: "account" })
      .mockResolvedValueOnce(cooldown(502));
    mocks.handleChatCore.mockResolvedValue({
      success: false,
      status: 429,
      error: "upstream quota exhausted",
      response: new Response("quota exhausted", { status: 429, headers: {
        "x-should-retry": "true", "anthropic-ratelimit-requests-limit": "25",
      } }),
    });

    const response = await chat();

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(response.headers.get("x-should-retry")).toBe("true");
    expect(response.headers.get("anthropic-ratelimit-requests-limit")).toBe("25");
    expect(await response.json()).toEqual({
      error: { message: "[openai/gpt-4o] upstream quota exhausted (reset after 60s)" },
    });
  });

  it.each([undefined, null, 200, 399, 600, 429.5, NaN, "not a status", {}, [429]].map((status) => ({ status })))(
    "keeps 503 when the cached error code is invalid: %j",
    async ({ status }) => {
      mocks.getProviderCredentials.mockResolvedValue(cooldown(status));
      const response = await chat();
      expect(response.status).toBe(503);
      expect(response.headers.get("retry-after")).toBe("60");
    },
  );

  it("keeps the no-credentials response distinct from a cooldown", async () => {
    mocks.getProviderCredentials.mockResolvedValue(null);
    const response = await chat();
    expect(response.status).toBe(404);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.has("retry-after")).toBe(false);
  });
});
