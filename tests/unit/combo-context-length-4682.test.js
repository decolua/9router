import { describe, it, expect, vi, beforeEach } from "vitest";

const fx = vi.hoisted(() => ({
  combos: [],
  connections: [],
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: async () => fx.connections.filter(c => c.isActive !== false),
  getCombos: async () => fx.combos,
  getCustomModels: async () => [],
  getModelAliases: async () => ({}),
  getDisabledModels: async () => ({}),
}));

vi.mock("@/shared/constants/providers.js", () => ({
  AI_PROVIDERS: {
    openai: { serviceKinds: ["llm"] },
    anthropic: { serviceKinds: ["llm"] },
    opencode: { serviceKinds: ["llm"], noAuth: true },
    deepseek: { serviceKinds: ["llm"] },
  },
  FREE_PROVIDERS: {
    opencode: { noAuth: true },
  },
  PROVIDER_ID_TO_ALIAS: { openai: "openai", anthropic: "anthropic", opencode: "oc", deepseek: "deepseek" },
  ALIAS_TO_ID: { oc: "opencode" },
  getProviderAlias: (id) => ({ openai: "openai", anthropic: "anthropic", opencode: "oc", deepseek: "deepseek" }[id]),
  isOpenAICompatibleProvider: (id) => ["openai", "deepseek"].includes(id),
  isAnthropicCompatibleProvider: (id) => id === "anthropic",
}));

vi.mock("@/shared/constants/models.js", () => ({
  PROVIDER_MODELS: {
    oc: [{ id: "mimo-v2.6-flash-free" }],
    openai: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }],
    anthropic: [{ id: "claude-sonnet-4.6" }, { id: "claude-haiku-4.5" }],
    deepseek: [{ id: "deepseek-chat" }, { id: "deepseek-reasoner" }],
  },
  PROVIDER_ID_TO_ALIAS: { openai: "openai", anthropic: "anthropic", opencode: "oc", deepseek: "deepseek" },
  getModelKind: () => "llm",
}));

vi.mock("@/sse/services/keyAccess.js", () => ({
  getKeyAccessContext: async () => ({ restricted: false, allowedCombos: [], allowedModels: [] }),
  filterModelsListForKey: async (ctx, models) => models,
  filterAdapterModels: async (ctx, models, original) => models,
}));

vi.mock("open-sse/providers/capabilities.js", () => {
  return {
    DEFAULT_CAPABILITIES: {
      vision: false, pdf: false, audioInput: false, videoInput: false,
      imageOutput: false, audioOutput: false, search: false, tools: true,
      reasoning: false, thinkingFormat: null, thinkingCanDisable: true,
      thinkingRange: null, thinkingEffortSupported: false,
      contextWindow: 200000, maxOutput: 64000,
    },
    getCapabilitiesForModel: vi.fn((provider, model) => {
      const caps = {
        "gpt-4o": { contextWindow: 128000, maxOutput: 16384, vision: true, tools: true, reasoning: false },
        "gpt-4o-mini": { contextWindow: 128000, maxOutput: 16384, vision: true, tools: true, reasoning: false },
        "claude-sonnet-4.6": { contextWindow: 1000000, maxOutput: 128000, vision: true, pdf: true, tools: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive" },
        "claude-haiku-4.5": { contextWindow: 200000, maxOutput: 8192, vision: true, pdf: true, tools: true, reasoning: true, search: true, thinkingFormat: "claude-budget" },
        "deepseek-chat": { contextWindow: 128000, maxOutput: 64000, tools: true, reasoning: true, thinkingFormat: "deepseek" },
        "deepseek-reasoner": { contextWindow: 128000, maxOutput: 64000, tools: true, reasoning: true, thinkingFormat: "deepseek", thinkingCanDisable: false },
        "mimo-v2.6-flash-free": { contextWindow: 32000, maxOutput: 8192, vision: true, audioInput: true, videoInput: true, tools: true, reasoning: true, thinkingFormat: "deepseek", thinkingCanDisable: false },
      };
      return caps[model] || { contextWindow: 200000, maxOutput: 64000, vision: false, tools: true, reasoning: false };
    }),
    aggregateComboCapabilities: vi.fn(),
    capabilitiesFromServiceKind: vi.fn(),
  };
});

const mod = await import("../../src/app/api/v1/models/route.js");
const { buildModelsList } = mod;

function resetFixture() {
  fx.combos = [];
  fx.connections = [];
}

function addCombo(name, models, kind = "llm") {
  fx.combos.push({ name, models, kind, fallbackStrategy: "fallback" });
}

function addConnection(id, provider, modelId = null) {
  fx.connections.push({
    id,
    provider,
    isActive: true,
    apiKey: `key-${id}`,
    providerSpecificData: {},
  });
}

describe("Combo context_length / max_completion_tokens (#4682)", () => {
  beforeEach(() => {
    resetFixture();
    vi.clearAllMocks();
  });

  it("combo with premium + free fallback publishes premium limits, not weakest", async () => {
    addConnection("conn-1", "anthropic");
    addCombo("test-combo", [
      "anthropic/claude-sonnet-4.6",
      "oc/mimo-v2.6-flash-free",
    ]);

    const models = await buildModelsList(["llm"]);
    const combo = models.find(m => m.id === "test-combo");
    
    expect(combo).toBeDefined();
    expect(combo.context_length).toBe(1000000);
    expect(combo.max_completion_tokens).toBe(128000);
  });

  it("combo with multiple premium seats publishes min of premium seats only", async () => {
    addConnection("conn-1", "anthropic");
    addCombo("premium-combo", [
      "anthropic/claude-sonnet-4.6",
      "anthropic/claude-haiku-4.5",
    ]);

    const models = await buildModelsList(["llm"]);
    const combo = models.find(m => m.id === "premium-combo");
    
    expect(combo).toBeDefined();
    expect(combo.context_length).toBe(200000);
    expect(combo.max_completion_tokens).toBe(8192);
  });

  it("combo with only free fallback seats publishes their limits", async () => {
    addCombo("free-combo", [
      "oc/mimo-v2.6-flash-free",
    ]);

    const models = await buildModelsList(["llm"]);
    const combo = models.find(m => m.id === "free-combo");
    
    expect(combo).toBeDefined();
    expect(combo.context_length).toBe(32000);
    expect(combo.max_completion_tokens).toBe(8192);
  });
});
