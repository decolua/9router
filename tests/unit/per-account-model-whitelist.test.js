import { beforeEach, describe, it, expect, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(),
  validateApiKey: vi.fn(),
  updateProviderConnection: vi.fn(),
  getSettings: vi.fn(),
}), { virtual: true });

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(),
}), { virtual: true });

const UI_ALIASES = { kilocode: "kc", codex: "cx", claude: "cc", openai: "openai", openrouter: "openrouter" };

vi.mock("@/shared/constants/providers.js", () => ({
  resolveProviderId: (provider) => provider,
  getProviderAlias: (id) => UI_ALIASES[id] || id,
  FREE_PROVIDERS: {},
}), { virtual: true });

vi.mock("open-sse/services/accountFallback.js", () => ({
  formatRetryAfter: vi.fn(),
  checkFallbackError: vi.fn(),
  isModelLockActive: vi.fn(() => false),
  buildModelLockUpdate: vi.fn(),
  getEarliestModelLockUntil: vi.fn(),
}), { virtual: true });

vi.mock("open-sse/config/errorConfig.js", () => ({
  MAX_RATE_LIMIT_COOLDOWN_MS: 0,
}), { virtual: true });

const localDb = await import("@/lib/localDb");
const { resolveConnectionProxyConfig } = await import("@/lib/network/connectionProxy");
const { isConnectionAllowedForModel, getProviderCredentials } = await import("../../src/sse/services/auth.js");

beforeEach(() => {
  vi.clearAllMocks();
  localDb.getSettings.mockResolvedValue({ fallbackStrategy: "fill-first", providerStrategies: {} });
  resolveConnectionProxyConfig.mockResolvedValue({
    connectionProxyEnabled: false,
    connectionProxyUrl: "",
    connectionNoProxy: "",
    proxyPoolId: null,
    vercelRelayUrl: "",
  });
});

function buildConnection(overrides = {}) {
  return {
    id: "conn-1",
    provider: "openai",
    isActive: true,
    name: "Test Account",
    displayName: "Test Account",
    priority: 1,
    providerSpecificData: {},
    ...overrides,
  };
}

function expectConnection(credentials, connectionId) {
  expect(credentials).toMatchObject({
    connectionId,
    connectionName: "Test Account",
  });
}

describe("isConnectionAllowedForModel", () => {
  it("treats undefined model as a no-op pass-through", () => {
    expect(isConnectionAllowedForModel({ allowedModels: ["gpt-5.5"] }, null)).toBe(true);
    expect(isConnectionAllowedForModel({ allowedModels: ["gpt-5.5"] }, undefined)).toBe(true);
  });

  it("allows every model when the connection has no whitelist", () => {
    expect(isConnectionAllowedForModel({}, "gpt-5.5")).toBe(true);
    expect(isConnectionAllowedForModel({ allowedModels: undefined }, "gpt-5.5")).toBe(true);
  });

  it("allows every model when the whitelist is empty", () => {
    expect(isConnectionAllowedForModel({ allowedModels: [] }, "gpt-5.5")).toBe(true);
  });

  it("allows models that are present in the whitelist", () => {
    expect(isConnectionAllowedForModel({ allowedModels: ["gpt-5.5", "gpt-5.4"] }, "gpt-5.5")).toBe(true);
  });

  it("allows provider-prefixed models that are present in the whitelist for the same provider", () => {
    expect(isConnectionAllowedForModel({ allowedModels: ["openai/gpt-5.5", "openai/gpt-5.4"] }, "gpt-5.5", "openai")).toBe(true);
  });

  it("allows provider-prefixed model IDs that contain slashes for the same provider", () => {
    expect(isConnectionAllowedForModel({ allowedModels: ["openrouter/anthropic/claude-sonnet-4"] }, "anthropic/claude-sonnet-4", "openrouter")).toBe(true);
  });

  it("blocks provider-prefixed models from a different provider", () => {
    expect(isConnectionAllowedForModel({ allowedModels: ["openai/gpt-5.5"] }, "gpt-5.5", "openrouter")).toBe(false);
  });

  it("blocks models that are not in the whitelist", () => {
    expect(isConnectionAllowedForModel({ allowedModels: ["gpt-5.5"] }, "gpt-5.3")).toBe(false);
  });

  it("is case-sensitive (preserves caller casing)", () => {
    expect(isConnectionAllowedForModel({ allowedModels: ["GPT-5.5"] }, "gpt-5.5")).toBe(false);
  });

  it("matches uiAlias-prefixed entries against the canonical provider id (alias !== id)", () => {
    // UI stores the short display alias (kc) but routing resolves it to the canonical id (kilocode).
    expect(isConnectionAllowedForModel({ allowedModels: ["kc/anthropic/claude-sonnet-4"] }, "anthropic/claude-sonnet-4", "kilocode")).toBe(true);
    expect(isConnectionAllowedForModel({ allowedModels: ["cx/gpt-5.5"] }, "gpt-5.5", "codex")).toBe(true);
    expect(isConnectionAllowedForModel({ allowedModels: ["cc/claude-sonnet-4"] }, "claude-sonnet-4", "claude")).toBe(true);
  });

  it("matches custom-provider display-prefix entries against the normalized node id", () => {
    // Custom OpenAI-compatible connections store the user display prefix (zm) but routing
    // normalizes the provider to openai-compatible-<uuid>.
    const connection = { allowedModels: ["zm/glm-4.7"], providerSpecificData: { prefix: "zm" } };
    expect(isConnectionAllowedForModel(connection, "glm-4.7", "openai-compatible-chat-abc")).toBe(true);
  });

  it("still blocks a whitelisted alias entry when the requested model differs", () => {
    expect(isConnectionAllowedForModel({ allowedModels: ["kc/anthropic/claude-sonnet-4"] }, "anthropic/claude-opus-4", "kilocode")).toBe(false);
  });

  it("does not let a custom display prefix bypass the model comparison", () => {
    const connection = { allowedModels: ["zm/glm-4.7"], providerSpecificData: { prefix: "zm" } };
    expect(isConnectionAllowedForModel(connection, "glm-4.9", "openai-compatible-chat-abc")).toBe(false);
  });
});

describe("getProviderCredentials model whitelist filtering", () => {
  it("enforces the connection model whitelist by default", async () => {
    localDb.getProviderConnections.mockResolvedValue([
      buildConnection({ id: "conn-blocked", allowedModels: ["openai/gpt-5.4"] }),
      buildConnection({ id: "conn-allowed", allowedModels: ["openai/gpt-5.5"] }),
    ]);

    const credentials = await getProviderCredentials("openai", null, "gpt-5.5");

    expectConnection(credentials, "conn-allowed");
  });

  it("bypasses the connection model whitelist when diagnostic bypass is enabled", async () => {
    localDb.getProviderConnections.mockResolvedValue([
      buildConnection({ id: "conn-bypassed", allowedModels: ["openai/gpt-5.4"] }),
      buildConnection({ id: "conn-allowed", allowedModels: ["openai/gpt-5.5"] }),
    ]);

    const credentials = await getProviderCredentials("openai", null, "gpt-5.5", { bypassModelWhitelist: true });

    expectConnection(credentials, "conn-bypassed");
  });

  it("keeps an alias-prefixed whitelist connection eligible for a provider whose alias !== id", async () => {
    // Regression: UI writes "kc/…" for kilocode; routing resolves the provider to "kilocode".
    // Before the fix this connection was wrongly filtered out (whitelist-miss).
    localDb.getProviderConnections.mockResolvedValue([
      buildConnection({ id: "conn-kc", provider: "kilocode", allowedModels: ["kc/anthropic/claude-sonnet-4"] }),
    ]);

    const credentials = await getProviderCredentials("kilocode", null, "anthropic/claude-sonnet-4");

    expectConnection(credentials, "conn-kc");
  });
});
