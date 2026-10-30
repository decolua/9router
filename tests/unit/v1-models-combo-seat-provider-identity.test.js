import { describe, expect, it, vi } from "vitest";
import { setCatalogSource, PROVIDER_CAPABILITIES, DEFAULT_CAPABILITIES } from "../../open-sse/providers/capabilities.js";

const db = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})),
}));

vi.mock("@/lib/localDb", () => db);
vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: vi.fn(async () => ({})),
}));

const { buildModelsList } = await import("../../src/app/api/v1/models/route.js");

// A custom (OpenAI-compatible) provider node. Its id is not in the static
// provider registry, so the only way to reach its own metadata is to resolve
// the seat prefix through the live connections.
const CUSTOM_NODE_ID = "openai-compatible-chat-00000000-0000-4000-8000-000000000000";
const CUSTOM_PREFIX = "cc";
const CUSTOM_MODEL = "vendor/custom-model-x";

// The custom node's authoritative window, as published by the provider itself.
// The node deliberately claims no output budget, so the metadata it publishes
// carries a context window and no output limit.
const CUSTOM_CONTEXT = 524288;

function customConnection(overrides = {}) {
  return {
    id: "custom-conn",
    provider: CUSTOM_NODE_ID,
    isActive: true,
    providerSpecificData: { prefix: CUSTOM_PREFIX, enabledModels: [CUSTOM_MODEL] },
    ...overrides,
  };
}

/**
 * Register a provider-scoped capability override — the mechanism a custom
 * provider node uses to state its own limits (upstream: PROVIDER_CAPABILITIES
 * keyed by provider id; production: the managed per-provider override in the
 * installed bundle). `maxOutput: undefined` means "this provider deliberately
 * publishes no output budget", which the generic default must not paper over.
 */
function registerProviderOverride(providerId, modelId, caps) {
  PROVIDER_CAPABILITIES[providerId] = {
    ...(PROVIDER_CAPABILITIES[providerId] || {}),
    [modelId]: caps,
  };
}

function clearProviderOverride(providerId) {
  delete PROVIDER_CAPABILITIES[providerId];
}

/**
 * Build the models list for a set of combos over the given connections.
 * Provider-scoped limits for built-in providers come from the synced catalog,
 * keyed by provider id + model id — the same key the direct-model path uses.
 */
async function modelsFor(combos, { connections = [customConnection()], limits = {} } = {}) {
  db.getProviderConnections.mockResolvedValue(connections);
  db.getCombos.mockResolvedValue(combos);
  setCatalogSource({
    getModalities: () => null,
    getLimits: (provider, model) => limits[provider]?.[model] ?? null,
  });
  try {
    return await buildModelsList(["llm"]);
  } finally {
    setCatalogSource(null);
  }
}

function published(models, id) {
  return models.find((model) => model.id === id);
}

describe("/v1/models combo seat provider identity", () => {
  it("publishes the custom provider's own window for the direct model", async () => {
    registerProviderOverride(CUSTOM_NODE_ID, CUSTOM_MODEL, {
      contextWindow: CUSTOM_CONTEXT,
      maxOutput: undefined,
    });
    try {
      const models = await modelsFor([]);
      const direct = published(models, `${CUSTOM_PREFIX}/${CUSTOM_MODEL}`);

      expect(direct).toBeDefined();
      expect(direct.context_length).toBe(CUSTOM_CONTEXT);
      expect(direct.capabilities.contextWindow).toBe(CUSTOM_CONTEXT);
      expect(direct.max_completion_tokens).toBeUndefined();
    } finally {
      clearProviderOverride(CUSTOM_NODE_ID);
    }
  });

  // The regression: a one-member combo must publish exactly its member's
  // limits. Before the fix the seat prefix resolved to the literal prefix
  // string instead of the provider node id, so the seat fell through to the
  // generic fallback limits instead of the provider's own metadata.
  it("publishes the member's window for a single-member combo", async () => {
    registerProviderOverride(CUSTOM_NODE_ID, CUSTOM_MODEL, {
      contextWindow: CUSTOM_CONTEXT,
      maxOutput: undefined,
    });
    try {
      const combos = [{ name: "single-member", models: [`${CUSTOM_PREFIX}/${CUSTOM_MODEL}`] }];
      const models = await modelsFor(combos);
      const combo = published(models, "single-member");

      expect(combo).toBeDefined();
      expect(combo.context_length).toBe(CUSTOM_CONTEXT);
      expect(combo.capabilities.contextWindow).toBe(CUSTOM_CONTEXT);
    } finally {
      clearProviderOverride(CUSTOM_NODE_ID);
    }
  });

  it("publishes a single-member combo's limits identically to its member", async () => {
    registerProviderOverride(CUSTOM_NODE_ID, CUSTOM_MODEL, {
      contextWindow: CUSTOM_CONTEXT,
      maxOutput: undefined,
    });
    try {
      const combos = [{ name: "single-member", models: [`${CUSTOM_PREFIX}/${CUSTOM_MODEL}`] }];
      const models = await modelsFor(combos);
      const member = published(models, `${CUSTOM_PREFIX}/${CUSTOM_MODEL}`);
      const combo = published(models, "single-member");

      expect(combo.context_length).toBe(member.context_length);
      expect(combo.max_completion_tokens).toBe(member.max_completion_tokens);
      expect(combo.capabilities.contextWindow).toBe(member.capabilities.contextWindow);
      expect(combo.capabilities.maxOutput).toBe(member.capabilities.maxOutput);
    } finally {
      clearProviderOverride(CUSTOM_NODE_ID);
    }
  });

  it("publishes no output budget for a member that claims none", async () => {
    registerProviderOverride(CUSTOM_NODE_ID, CUSTOM_MODEL, {
      contextWindow: CUSTOM_CONTEXT,
      maxOutput: undefined,
    });
    try {
      const combos = [{ name: "single-member", models: [`${CUSTOM_PREFIX}/${CUSTOM_MODEL}`] }];
      const models = await modelsFor(combos);
      const combo = published(models, "single-member");

      // The provider publishes a context window but no output budget, so the
      // combo must not invent one from an unrelated generic capability.
      expect(combo.max_completion_tokens).toBeUndefined();
      expect(combo.capabilities.maxOutput).toBeUndefined();
    } finally {
      clearProviderOverride(CUSTOM_NODE_ID);
    }
  });

  it("does not downgrade a member to the generic fallback limits", async () => {
    registerProviderOverride(CUSTOM_NODE_ID, CUSTOM_MODEL, {
      contextWindow: CUSTOM_CONTEXT,
      maxOutput: undefined,
    });
    try {
      const combos = [{ name: "single-member", models: [`${CUSTOM_PREFIX}/${CUSTOM_MODEL}`] }];
      const models = await modelsFor(combos);
      const combo = published(models, "single-member");

      // An unresolved seat falls back to the generic default limits. The combo
      // must publish the provider's own window, not that fallback.
      expect(combo.context_length).not.toBe(DEFAULT_CAPABILITIES.contextWindow);
      expect(combo.capabilities.contextWindow).not.toBe(DEFAULT_CAPABILITIES.contextWindow);
      expect(combo.context_length).toBe(CUSTOM_CONTEXT);
    } finally {
      clearProviderOverride(CUSTOM_NODE_ID);
    }
  });
});

describe("/v1/models combo aggregation", () => {
  it("publishes the smallest window across multiple members", async () => {
    registerProviderOverride(CUSTOM_NODE_ID, CUSTOM_MODEL, {
      contextWindow: CUSTOM_CONTEXT,
      maxOutput: undefined,
    });
    try {
      const other = "opencode-go";
      const combos = [
        {
          name: "multi-member",
          models: [`${CUSTOM_PREFIX}/${CUSTOM_MODEL}`, `${other}/mimo-v2.5`],
        },
      ];
      const models = await modelsFor(combos, {
        connections: [
          customConnection(),
          {
            id: "other-conn",
            provider: other,
            isActive: true,
            providerSpecificData: { enabledModels: ["mimo-v2.5"] },
          },
        ],
        limits: { [other]: { "mimo-v2.5": { contextWindow: 1048576, maxOutput: 131072 } } },
      });
      const combo = published(models, "multi-member");

      // mimo-v2.5 publishes 1048576; the custom member publishes 524288.
      expect(combo.context_length).toBe(CUSTOM_CONTEXT);
      expect(combo.capabilities.contextWindow).toBe(CUSTOM_CONTEXT);
    } finally {
      clearProviderOverride(CUSTOM_NODE_ID);
    }
  });

  it("resolves a nested combo to its effective limits", async () => {
    registerProviderOverride(CUSTOM_NODE_ID, CUSTOM_MODEL, {
      contextWindow: CUSTOM_CONTEXT,
      maxOutput: undefined,
    });
    try {
      const combos = [
        { name: "inner", models: [`${CUSTOM_PREFIX}/${CUSTOM_MODEL}`] },
        { name: "outer", models: ["inner"] },
      ];
      const models = await modelsFor(combos);
      const outer = published(models, "outer");

      expect(outer.context_length).toBe(CUSTOM_CONTEXT);
      expect(outer.capabilities.contextWindow).toBe(CUSTOM_CONTEXT);
    } finally {
      clearProviderOverride(CUSTOM_NODE_ID);
    }
  });

  it("resolves a nested combo that mixes a custom member and a built-in", async () => {
    registerProviderOverride(CUSTOM_NODE_ID, CUSTOM_MODEL, {
      contextWindow: CUSTOM_CONTEXT,
      maxOutput: undefined,
    });
    try {
      const combos = [
        { name: "inner", models: [`${CUSTOM_PREFIX}/${CUSTOM_MODEL}`, "ollama/minimax-m3.1-flash"] },
        { name: "outer", models: ["inner"] },
      ];
      const models = await modelsFor(combos);
      const outer = published(models, "outer");

      expect(outer.context_length).toBe(CUSTOM_CONTEXT);
    } finally {
      clearProviderOverride(CUSTOM_NODE_ID);
    }
  });

  it("terminates on a cyclic combo without hanging or throwing", async () => {
    const combos = [
      { name: "cycle-a", models: ["cycle-b"] },
      { name: "cycle-b", models: ["cycle-a"] },
    ];
    const models = await modelsFor(combos);

    expect(published(models, "cycle-a")).toBeDefined();
    expect(published(models, "cycle-b")).toBeDefined();
  });

  it("terminates on a self-referencing combo", async () => {
    const combos = [{ name: "self", models: ["self"] }];
    const models = await modelsFor(combos);

    expect(published(models, "self")).toBeDefined();
  });
});

describe("/v1/models combo seat resolution variants", () => {
  it("resolves a seat whose prefix is a built-in provider alias", async () => {
    const combos = [{ name: "alias-seat", models: ["ocg/mimo-v2.5"] }];
    const models = await modelsFor(combos, {
      connections: [
        {
          id: "ocg-conn",
          provider: "opencode-go",
          isActive: true,
          providerSpecificData: { enabledModels: ["mimo-v2.5"] },
        },
      ],
      limits: { "opencode-go": { "mimo-v2.5": { contextWindow: 180000, maxOutput: 16000 } } },
    });
    const combo = published(models, "alias-seat");

    expect(combo.context_length).toBe(180000);
    expect(combo.max_completion_tokens).toBe(16000);
    expect(combo.capabilities.contextWindow).toBe(180000);
    expect(combo.capabilities.maxOutput).toBe(16000);
  });

  it("resolves a seat written with the provider node id rather than the prefix", async () => {
    registerProviderOverride(CUSTOM_NODE_ID, CUSTOM_MODEL, {
      contextWindow: CUSTOM_CONTEXT,
      maxOutput: undefined,
    });
    try {
      const combos = [{ name: "node-id-seat", models: [`${CUSTOM_NODE_ID}/${CUSTOM_MODEL}`] }];
      const models = await modelsFor(combos);
      const combo = published(models, "node-id-seat");

      expect(combo.context_length).toBe(CUSTOM_CONTEXT);
    } finally {
      clearProviderOverride(CUSTOM_NODE_ID);
    }
  });

  it("keeps the provider-prefixed custom model id stable", async () => {
    registerProviderOverride(CUSTOM_NODE_ID, CUSTOM_MODEL, {
      contextWindow: CUSTOM_CONTEXT,
      maxOutput: undefined,
    });
    try {
      const combos = [{ name: "prefixed", models: [`${CUSTOM_PREFIX}/${CUSTOM_MODEL}`] }];
      const models = await modelsFor(combos);

      expect(published(models, `${CUSTOM_PREFIX}/${CUSTOM_MODEL}`)).toBeDefined();
      expect(published(models, "prefixed").id).toBe("prefixed");
    } finally {
      clearProviderOverride(CUSTOM_NODE_ID);
    }
  });
});

describe("/v1/models unknown capability metadata", () => {
  it("publishes no output promise for a member that declares no output budget", async () => {
    registerProviderOverride(CUSTOM_NODE_ID, CUSTOM_MODEL, {
      contextWindow: CUSTOM_CONTEXT,
      maxOutput: undefined,
    });
    try {
      const combos = [{ name: "no-output", models: [`${CUSTOM_PREFIX}/${CUSTOM_MODEL}`] }];
      const models = await modelsFor(combos);
      const combo = published(models, "no-output");

      expect(combo.max_completion_tokens).toBeUndefined();
      expect(combo.capabilities.maxOutput).toBeUndefined();
    } finally {
      clearProviderOverride(CUSTOM_NODE_ID);
    }
  });

  it("publishes no context promise for a member that declares no context window", async () => {
    registerProviderOverride(CUSTOM_NODE_ID, CUSTOM_MODEL, {
      contextWindow: undefined,
      maxOutput: 32000,
    });
    try {
      const combos = [{ name: "no-context", models: [`${CUSTOM_PREFIX}/${CUSTOM_MODEL}`] }];
      const models = await modelsFor(combos);
      const combo = published(models, "no-context");

      expect(combo.context_length).toBeUndefined();
      expect(combo.capabilities.contextWindow).toBeUndefined();
      expect(combo.max_completion_tokens).toBe(32000);
    } finally {
      clearProviderOverride(CUSTOM_NODE_ID);
    }
  });

  it("does not publish null for an unknown limit", async () => {
    const combos = [{ name: "unknown-seat", models: ["nosuchprovider/nosuchmodel"] }];
    const models = await modelsFor(combos);
    const combo = published(models, "unknown-seat");

    expect(combo.context_length).not.toBeNull();
    expect(combo.max_completion_tokens).not.toBeNull();
    expect(combo.capabilities.contextWindow).not.toBeNull();
    expect(combo.capabilities.maxOutput).not.toBeNull();
  });

  it("does not promise the larger known seat's window when another seat is unknown", async () => {
    registerProviderOverride(CUSTOM_NODE_ID, CUSTOM_MODEL, {
      contextWindow: CUSTOM_CONTEXT,
      maxOutput: undefined,
    });
    try {
      const combos = [
        {
          name: "mixed",
          models: [`${CUSTOM_PREFIX}/${CUSTOM_MODEL}`, "nosuchprovider/nosuchmodel"],
        },
      ];
      const models = await modelsFor(combos);
      const combo = published(models, "mixed");

      // The unknown seat cannot be relied on, so the promise must not be the
      // larger known seat's window.
      expect(combo.context_length).not.toBe(CUSTOM_CONTEXT);
    } finally {
      clearProviderOverride(CUSTOM_NODE_ID);
    }
  });
});

describe("/v1/models output-token aggregation", () => {
  it("does not promise an output budget when a member declares none", async () => {
    registerProviderOverride(CUSTOM_NODE_ID, CUSTOM_MODEL, {
      contextWindow: CUSTOM_CONTEXT,
      maxOutput: undefined,
    });
    try {
      const combos = [
        {
          name: "outputs",
          models: [`${CUSTOM_PREFIX}/${CUSTOM_MODEL}`, "cx/gpt-6.1-terra[1m]"],
        },
      ];
      const models = await modelsFor(combos, {
        connections: [
          customConnection(),
          {
            id: "cx-conn",
            provider: "cx",
            isActive: true,
            providerSpecificData: { enabledModels: ["gpt-6.1-terra[1m]"] },
          },
        ],
        limits: {
          cx: { "gpt-6.1-terra[1m]": { contextWindow: 1050000, maxOutput: 128000 } },
        },
      });
      const combo = published(models, "outputs");

      // The custom member declares no output budget, so the combo cannot
      // promise 128000 — and no unrelated generic value replaces it.
      expect(combo.max_completion_tokens).toBeUndefined();
    } finally {
      clearProviderOverride(CUSTOM_NODE_ID);
    }
  });

  it("publishes the largest output budget in the capability badge", async () => {
    registerProviderOverride(CUSTOM_NODE_ID, CUSTOM_MODEL, {
      contextWindow: CUSTOM_CONTEXT,
      maxOutput: undefined,
    });
    try {
      const combos = [
        {
          name: "outputs",
          models: [`${CUSTOM_PREFIX}/${CUSTOM_MODEL}`, "cx/gpt-6.1-terra[1m]"],
        },
      ];
      const models = await modelsFor(combos, {
        connections: [
          customConnection(),
          {
            id: "cx-conn",
            provider: "cx",
            isActive: true,
            providerSpecificData: { enabledModels: ["gpt-6.1-terra[1m]"] },
          },
        ],
        limits: {
          cx: { "gpt-6.1-terra[1m]": { contextWindow: 1050000, maxOutput: 128000 } },
        },
      });
      const combo = published(models, "outputs");

      // The badge is the union of what the seats can do: max output.
      expect(combo.capabilities.maxOutput).toBe(128000);
    } finally {
      clearProviderOverride(CUSTOM_NODE_ID);
    }
  });
});

describe("/v1/models existing behaviour is preserved", () => {
  it("keeps Paid-Models' published limits", async () => {
    const combos = [
      { name: "Paid-Models", models: ["cx/gpt-6.1-terra[1m]", "ollama/minimax-m3.1-flash"] },
    ];
    const models = await modelsFor(combos, {
      connections: [
        {
          id: "cx-conn",
          provider: "cx",
          isActive: true,
          providerSpecificData: { enabledModels: ["gpt-6.1-terra[1m]"] },
        },
        {
          id: "ollama-conn",
          provider: "ollama",
          isActive: true,
          providerSpecificData: { enabledModels: ["minimax-m3.1-flash"] },
        },
      ],
      limits: {
        cx: { "gpt-6.1-terra[1m]": { contextWindow: 1050000, maxOutput: 128000 } },
        ollama: { "minimax-m3.1-flash": { contextWindow: 1000000, maxOutput: 131072 } },
      },
    });
    const paid = published(models, "Paid-Models");

    expect(paid.context_length).toBe(1000000);
    expect(paid.max_completion_tokens).toBe(128000);
    expect(paid.capabilities.contextWindow).toBe(1000000);
    expect(paid.capabilities.maxOutput).toBe(131072);
  });

  it("resolves a mixed combo to its smallest member", async () => {
    registerProviderOverride(CUSTOM_NODE_ID, CUSTOM_MODEL, {
      contextWindow: CUSTOM_CONTEXT,
      maxOutput: undefined,
    });
    try {
      const combos = [
        { name: "Fallback", models: ["Paid-Models", `${CUSTOM_PREFIX}/${CUSTOM_MODEL}`] },
        { name: "Paid-Models", models: ["cx/gpt-6.1-terra[1m]", "ollama/minimax-m3.1-flash"] },
      ];
      const models = await modelsFor(combos, {
        connections: [
          customConnection(),
          {
            id: "cx-conn",
            provider: "cx",
            isActive: true,
            providerSpecificData: { enabledModels: ["gpt-6.1-terra[1m]"] },
          },
          {
            id: "ollama-conn",
            provider: "ollama",
            isActive: true,
            providerSpecificData: { enabledModels: ["minimax-m3.1-flash"] },
          },
        ],
        limits: {
          cx: { "gpt-6.1-terra[1m]": { contextWindow: 1050000, maxOutput: 128000 } },
          ollama: { "minimax-m3.1-flash": { contextWindow: 1000000, maxOutput: 131072 } },
        },
      });
      const fallback = published(models, "Fallback");

      expect(fallback.context_length).toBe(CUSTOM_CONTEXT);
      expect(fallback.capabilities.contextWindow).toBe(CUSTOM_CONTEXT);
    } finally {
      clearProviderOverride(CUSTOM_NODE_ID);
    }
  });
});
