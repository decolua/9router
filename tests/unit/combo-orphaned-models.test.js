// Test for issue #4915: Deleting Provider Connection Leaves Orphaned Models in Combos
// When a provider's last connection is deleted, combos containing that provider's models
// should filter out those orphaned models instead of failing over with "no credentials" errors.

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

  it("handleComboChat works with remaining models after filtering orphaned ones", async () => {
    addConnection("conn1", "openai", true);
    addCombo("my-combo", ["openai/gpt-4", "openai/gpt-3.5-turbo"]);

    // Mock handleSingleModel to simulate the provider call - first fails, second succeeds
    let callCount = 0;
    const handleSingleModel = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: false,
          status: 500,
          error: "Server error",
          response: new Response("server error", { status: 500 }),
        };
      }
      return {
        ok: true,
        status: 200,
        response: new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      };
    });

    const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };

    // With connection present - should work with fallback
    const resultWithConn = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["openai/gpt-4", "openai/gpt-3.5-turbo"],
      handleSingleModel,
      log,
      comboName: "my-combo",
      comboStrategy: "fallback",
    });

    expect(resultWithConn.status).toBe(200);

    // Now remove connection
    fx.connections = [];
    handleSingleModel.mockClear();
    callCount = 0;

    // After fix: combo returns null (no models), so handleComboChat won't be called
    // The chat handler should handle null combo models appropriately
    const models = await getComboModels("my-combo");
    expect(models).toBeNull();
  });

  it("getComboModels filters out models whose provider has no active connections (mixed providers)", async () => {
    // Setup: combo with multiple providers, one has no connections
    addConnection("conn1", "openai", true);
    addCombo("mixed-combo", ["openai/gpt-4", "anthropic/claude-3", "openai/gpt-3.5-turbo"]);

    // All models returned when both providers have connections
    let models = await getComboModels("mixed-combo");
    expect(models).toEqual(["openai/gpt-4", "openai/gpt-3.5-turbo"]); // anthropic filtered out (no connection)

    // Add anthropic connection
    addConnection("conn2", "anthropic", true);
    models = await getComboModels("mixed-combo");
    expect(models).toEqual(["openai/gpt-4", "anthropic/claude-3", "openai/gpt-3.5-turbo"]);

    // Remove anthropic connection
    fx.connections = fx.connections.filter((c) => c.provider !== "anthropic");
    models = await getComboModels("mixed-combo");
    expect(models).toEqual(["openai/gpt-4", "openai/gpt-3.5-turbo"]);
  });

  it("getComboModels returns null when combo has only orphaned models", async () => {
    // Combo with only anthropic models, no anthropic connections
    addCombo("orphaned-combo", ["anthropic/claude-3", "anthropic/claude-3-haiku"]);

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