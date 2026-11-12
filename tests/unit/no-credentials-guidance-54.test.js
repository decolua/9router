import { beforeEach, describe, expect, it, vi } from "vitest";
import { AI_PROVIDERS } from "@/shared/constants/providers";

// DF-9ROUTER-54 C2 — the fresh-install chat 404 must point the caller at the
// model discovery surface instead of dead-ending on a bare
// "No active credentials for provider: X", while /v1/models answers 200 with
// the handful of models that genuinely work without a connection.
//
// Driven through the real handleChat -> real auth.js against a mocked store, so
// the assertions cover the actual 404 branch (excludeConnectionIds.size === 0),
// not a copy of its message. Only the DB, usage persistence and token refresh
// are mocked; no network.

const fx = vi.hoisted(() => ({ connections: [] }));

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
  validateApiKey: vi.fn(),
  getProxyPools: vi.fn(),
  getModelAliases: vi.fn(),
  getComboByName: vi.fn(),
  getProviderNodes: vi.fn(),
  checkAndRefreshToken: vi.fn(),
  updateProviderCredentials: vi.fn(),
  getApiKeyByKey: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  getProviderConnections: mocks.getProviderConnections,
  updateProviderConnection: mocks.updateProviderConnection,
  validateApiKey: mocks.validateApiKey,
  getProxyPools: mocks.getProxyPools,
  getModelAliases: mocks.getModelAliases,
  getComboByName: mocks.getComboByName,
  getProviderNodes: mocks.getProviderNodes,
}));

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(async () => {}),
}));

vi.mock("@/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: mocks.checkAndRefreshToken,
  updateProviderCredentials: mocks.updateProviderCredentials,
}));

vi.mock("@/lib/db/repos/apiKeysRepo.js", () => ({
  getApiKeyByKey: mocks.getApiKeyByKey,
}));

vi.mock("@/lib/db/repos/combosRepo.js", () => ({
  getCombos: async () => [],
}));

const { handleChat, noCredentialsMessage } = await import("../../src/sse/handlers/chat.js");

// A credential-required provider: no stored connection => real auth.js returns
// null => the 404 branch under test.
const REQUESTED = "anthropic/claude-sonnet-4-20250514";
const REQUESTED_PROVIDER = "anthropic";
const MESSAGE_BUDGET = 200;

// Longest identifier a routed provider name can realistically be: the longest
// registry id/alias, or a generated openai-compatible node id.
const LONGEST_REGISTERED = Object.entries(AI_PROVIDERS)
  .flatMap(([id, entry]) => [id, entry.alias].filter(Boolean))
  .reduce((longest, name) => (name.length > longest.length ? name : longest), "");
const NODE_STYLE_ID = "openai-compatible-chat-3f6c1d2e-1111-4222-8333-444455556666";

async function chat(modelStr) {
  return handleChat(new Request("https://router.test/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer client-key" },
    body: JSON.stringify({ model: modelStr, messages: [{ role: "user", content: "hi" }], stream: false }),
  }));
}

describe("fresh-install chat 404 guidance (DF-9ROUTER-54 C2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fx.connections = [];
    mocks.getSettings.mockResolvedValue({});
    mocks.getModelAliases.mockResolvedValue({});
    mocks.getComboByName.mockResolvedValue(null);
    mocks.getProxyPools.mockResolvedValue([]);
    mocks.getProviderNodes.mockResolvedValue([]);
    mocks.validateApiKey.mockResolvedValue(true);
    mocks.updateProviderConnection.mockResolvedValue({});
    mocks.getApiKeyByKey.mockResolvedValue(null);
    mocks.checkAndRefreshToken.mockImplementation(async (_provider, credentials) => credentials);
    // Honours the same filter auth.js passes, so the requested provider really
    // has no connection while other providers can.
    mocks.getProviderConnections.mockImplementation(async (filter = {}) => fx.connections.filter((c) => {
      if (filter?.provider && c.provider !== filter.provider) return false;
      if (filter?.isActive !== undefined && c.isActive !== filter.isActive) return false;
      return true;
    }));
  });

  it("points a zero-connection install at /v1/models instead of dead-ending", async () => {
    const response = await chat(REQUESTED);
    const body = await response.json();

    expect(response.status).toBe(404);
    // The wire contract is unchanged...
    expect(body.error.code).toBe("model_not_found");
    // ...and the legacy prefix still matches, so existing clients and log
    // greps keep working.
    expect(body.error.message).toContain(`No active credentials for provider: ${REQUESTED_PROVIDER}`);
    // ...but the message now carries the actionable half.
    expect(body.error.message).toContain("/v1/models");
    expect(body.error.message.length).toBeLessThan(MESSAGE_BUDGET);

    // Error path only: no credential was cooled down or marked unavailable.
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("names the providers that DO have a connection, so 'nothing configured' reads differently from 'not this one'", async () => {
    fx.connections = [
      { id: "conn-openai", provider: "openai", isActive: true },
      { id: "conn-deepseek", provider: "deepseek", isActive: true },
      // Inactive rows are not configured for use and must not be advertised.
      { id: "conn-off", provider: "gemini", isActive: false },
    ];

    const response = await chat(REQUESTED);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.message).toContain("openai");
    expect(body.error.message).toContain("deepseek");
    expect(body.error.message).not.toContain("gemini");
    expect(body.error.message).toContain("/v1/models");
    expect(body.error.message.length).toBeLessThan(MESSAGE_BUDGET);
  });

  it("keeps the guidance when the configured-provider lookup fails", async () => {
    // auth.js's filtered lookup still answers (so the provider genuinely has no
    // connection); the unfiltered inventory read is what breaks.
    mocks.getProviderConnections.mockImplementation(async (filter) => {
      if (!filter || Object.keys(filter).length === 0) throw new Error("db unavailable");
      return [];
    });

    const response = await chat(REQUESTED);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.message).toContain("/v1/models");
    expect(body.error.message.length).toBeLessThan(MESSAGE_BUDGET);
  });

  it("formats within budget for the longest provider identifier and caps a long inventory", () => {
    expect(LONGEST_REGISTERED.length).toBeGreaterThan(0);

    // Mandatory guidance fits for every realistic provider name.
    for (const provider of [LONGEST_REGISTERED, NODE_STYLE_ID, REQUESTED_PROVIDER, "opencode"]) {
      const message = noCredentialsMessage(provider, null);
      expect(message).toContain(provider);
      expect(message).toContain("/v1/models");
      expect(message.length).toBeLessThan(MESSAGE_BUDGET);

      // A DB hiccup (null) and a genuinely empty inventory read identically.
      expect(noCredentialsMessage(provider, [])).toBe(message);
    }

    // A long inventory is capped, and the whole message is dropped back to the
    // guidance rather than ever exceeding the budget.
    const many = ["openai", "deepseek", "anthropic", "gemini", "xai", "mistral", "groq"];
    const capped = noCredentialsMessage(LONGEST_REGISTERED, many);
    expect(capped.length).toBeLessThan(MESSAGE_BUDGET);
    expect(capped).toContain("openai");
    expect(capped).not.toContain("mistral");

    // Every registered identifier stays inside the budget even with a list.
    for (const [id, entry] of Object.entries(AI_PROVIDERS)) {
      for (const name of [id, entry.alias].filter(Boolean)) {
        expect(noCredentialsMessage(name, many).length).toBeLessThan(MESSAGE_BUDGET);
      }
    }
  });
});
