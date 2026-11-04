// Test for issue #4915: Deleting Provider Connection Leaves Orphaned Models in Combos
// Also covers regression: provider aliases and noAuth providers should not be filtered out

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const fx = vi.hoisted(() => ({
  connections: [],
  combos: [],
  settings: { comboStrategy: "fallback" },
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: async (filter = {}) => {
    let list = fx.connections.filter((c) => c.isActive !== false);
    if (filter.provider) list = list.filter((c) => c.provider === filter.provider);
    if (filter.isActive !== undefined) list = list.filter((c) => (c.isActive !== false) === filter.isActive);
    list.sort((a, b) => (a.priority || 999) - (b.priority || 999));
    return list;
  },
  getComboByName: async (name) => fx.combos.find((c) => c.name === name) || null,
  getCombos: async () => fx.combos,
  getSettings: async () => fx.settings,
  getModelAliases: async () => ({}),
  getProviderNodes: async () => [],
}));

vi.mock("@/sse/utils/logger.js", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/shared/constants/providers.js", () => ({
  resolveProviderId: (id) => id,
  FREE_PROVIDERS: {},
  getProviderAlias: (id) => id,
}));

// Import after mocks
const { getComboModels } = await import("../../src/sse/services/model.js");
const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
const { handleComboChat } = await import("../../open-sse/services/combo.js");

function resetFixture() {
  fx.connections = [];
  fx.combos = [];
  fx.settings = { comboStrategy: "fallback" };
}

function addConnection(id, provider, isActive = true) {
  fx.connections.push({
    id,
    provider,
    authType: "apikey",
    name: `conn-${id}`,
    priority: 1,
    isActive,
    apiKey: `sk-${id}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

function addCombo(name, models) {
  fx.combos.push({ id: `combo-${name}`, name, models, kind: "fallback", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
}

describe("combo orphaned models (#4915)", () => {
  beforeEach(() => {
    resetFixture();
    vi.clearAllMocks();
  });

  it("getComboModels filters out models whose provider has no active connections", async () => {
    // Setup: combo with openai models, one active openai connection
    addConnection("conn1", "openai", true);
    addCombo("my-combo", ["openai/gpt-4", "openai/gpt-3.5-turbo"]);

    let models = await getComboModels("my-combo");
    expect(models).toEqual(["openai/gpt-4", "openai/gpt-3.5-turbo"]);

    // Now delete the only connection
    fx.connections = []; // simulate deletion

    // After fix: returns null (no models with active connections)
    models = await getComboModels("my-combo");
    expect(models).toBeNull();
  });

  it("getProviderCredentials returns null when no active connections for provider", async () => {
    // No connections at all
    const creds = await getProviderCredentials("openai", null, "gpt-4");
    expect(creds).toBeNull();
  });

  it("getComboModels KEEPS noAuth provider models even without connections (opencode/oc)", async () => {
    // opencode has noAuth: true and alias "oc" - models should NOT be filtered
    addCombo("free-combo", ["oc/muse-spark-1.3-contributor-free", "oc/union-alpha"]);

    // No connections for opencode (it's noAuth)
    const models = await getComboModels("free-combo");

    // Should keep both models because opencode is noAuth
    expect(models).toEqual(["oc/muse-spark-1.3-contributor-free", "oc/union-alpha"]);
  });

  it("getComboModels KEEPS models with provider alias (e.g., cc for claude) when connection exists by id", async () => {
    // If user has claude connection (provider id "claude") but uses alias "cc" in combo
    // Current bug: compares "cc" with "claude" → filters out incorrectly
    addConnection("conn1", "claude", true); // connection has provider "claude"
    addCombo("alias-combo", ["cc/claude-3", "cc/claude-3-haiku"]);

    const models = await getComboModels("alias-combo");

    // Should keep models because "cc" is alias for "claude" which has active connection
    expect(models).toEqual(["cc/claude-3", "cc/claude-3-haiku"]);
  });

  it("getComboModels filters out models from provider without connection (openai without connection)", async () => {
    // openai requires connection, no connection = filtered
    addCombo("orphaned-combo", ["openai/gpt-4", "openai/gpt-3.5-turbo"]);

    const models = await getComboModels("orphaned-combo");

    expect(models).toBeNull();
  });

  it("getComboModels preserves nested combo names (no slash format)", async () => {
    addConnection("conn1", "openai", true);
    addCombo("parent-combo", ["openai/gpt-4", "nested-combo"]);
    addCombo("nested-combo", ["openai/gpt-3.5-turbo", "anthropic/claude-3"]);

    // Should preserve nested combo name even if its provider has no connection
    // (nested combos are resolved recursively at call time)
    const models = await getComboModels("parent-combo");
    expect(models).toEqual(["openai/gpt-4", "nested-combo"]);
  });
});