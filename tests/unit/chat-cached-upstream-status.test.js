import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  handleChatCore: vi.fn(),
  getComboByName: vi.fn(),
  getCombos: vi.fn(),
}));

vi.mock("open-sse/index.js", () => ({}));
vi.mock("@/lib/localDb", () => ({
  getSettings: async () => ({ requireApiKey: false }),
  getModelAliases: async () => ({}),
  getComboByName: mocks.getComboByName,
  getProviderNodes: async () => [],
  getCombos: mocks.getCombos,
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

const chat = (model = "openai/gpt-4o") => handleChat(new Request("http://localhost/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }] }),
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
  mocks.getComboByName.mockResolvedValue(null);
  mocks.getCombos.mockResolvedValue([]);
  vi.spyOn(Date, "now").mockReturnValue(1900000000000);
  mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: true, cooldownMs: 0 });
});
afterEach(() => vi.restoreAllMocks());

describe("cached upstream chat errors (#4663)", () => {
  it.each(["cc/claude-opus-5-5", "cx/gpt-6.1-sol"])("preserves OAuth cooldown status on %s", async (model) => {
    mocks.getProviderCredentials.mockResolvedValue(cooldown(429));
    const response = await chat(model);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(mocks.handleChatCore).not.toHaveBeenCalled();
  });

  it("preserves 429 and the earliest reset in the reported mixed OAuth/free combo", async () => {
    const models = ["cc/claude-opus-5-5", "cx/gpt-6.1-sol", "oc/deepseek-v4.1-flash-free"];
    const combo = { name: "Prod_Conteudo", models, strategy: "fallback" };
    mocks.getComboByName.mockResolvedValue(combo);
    mocks.getCombos.mockResolvedValue([combo]);
    let claudeAttempts = 0;
    mocks.getProviderCredentials.mockImplementation(async (provider) => {
      if (provider === "claude") {
        if (claudeAttempts++ < 2) return { connectionId: `claude-${claudeAttempts}`, connectionName: `Claude ${claudeAttempts}` };
        return { ...cooldown(429), retryAfter: new Date(Date.now() + 120000).toISOString() };
      }
      if (provider === "codex") return { ...cooldown("429"), retryAfter: new Date(Date.now() + 20000).toISOString() };
      return { connectionId: "noauth", connectionName: "Public" };
    });
    mocks.handleChatCore.mockImplementation(async ({ modelInfo }) => ({
      success: false, status: 429, error: modelInfo.provider === "opencode" ? "FreeUsageLimitError" : "rate_limit_error",
      response: new Response(JSON.stringify({ error: { message: "usage limit reached" } }), {
        status: 429, headers: { "content-type": "application/json", "retry-after": "60" },
      }),
    }));
    mocks.markAccountUnavailable.mockImplementation(async (id) => ({ shouldFallback: id !== "noauth", cooldownMs: 0 }));

    const response = await chat(combo.name);

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("20");
    expect(mocks.handleChatCore.mock.calls.map(([options]) => options.modelInfo.provider)).toEqual(["claude", "claude", "opencode"]);
  });

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
