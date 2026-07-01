import { describe, it, expect, vi } from "vitest";

// Stub the open-sse and constants modules the helpers transitively import.
// We don't need the real provider catalogs for these unit tests; we only
// exercise buildCompatibleProviderGroup / buildGroupedModels, which take
// the resolved catalog as input. Stubbing keeps the test independent of
// the full provider registry (which has heavy transitive imports).
vi.mock("open-sse/providers/registry/index.js", () => ({ default: [] }));
vi.mock("@/shared/constants/providersDisplay", () => ({ RISK_NOTICE: "" }));
vi.mock("../constants/providers.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    OAUTH_PROVIDERS: {},
    APIKEY_PROVIDERS: {},
    FREE_PROVIDERS: {},
    FREE_TIER_PROVIDERS: {},
  };
});
vi.mock("../constants/models.js", () => ({
  getProviderModels: () => [],
  getModelsByProviderId: () => [],
  getModelKind: () => "llm",
  isValidModel: () => true,
  findModelName: () => null,
  getModelTargetFormat: () => null,
  getModelStrip: (id) => id,
  PROVIDER_ID_TO_ALIAS: {},
  getDefaultModel: () => null,
  getModelUpstreamId: (id) => id,
  getModelQuotaFamily: () => null,
}));

const { buildGroupedModels, buildCompatibleProviderGroup } = await import("./modelSelectGroups.js");

// An anthropic-compatible provider as the dashboard would surface it:
// - providerId is the generated compatible id ("anthropic-compatible-<uuid>")
// - the user has a configured prefix "open-claude" they typed when creating
//   the node, used as the model value prefix in the picker
// - models imported via "Import from /models" land in /api/models/custom with
//   providerAlias === providerId (see provider page CompatibleModelsSection)
const ANTHROPIC_COMPAT_ID = "anthropic-compatible-abc-123";
const OPEN_CLAUDE_PREFIX = "open-claude";
const activeProviders = [
  {
    provider: ANTHROPIC_COMPAT_ID,
    providerSpecificData: { prefix: OPEN_CLAUDE_PREFIX, baseUrl: "https://api.example.com" },
  },
];
const providerNodes = [
  { id: ANTHROPIC_COMPAT_ID, name: "open-claude", prefix: OPEN_CLAUDE_PREFIX, type: "anthropic-compatible" },
];

const baseInput = {
  filteredActiveProviders: activeProviders,
  modelAliases: {},
  customModels: [],
  providerNodes,
  disabledModels: {},
  kindFilter: null,
};

describe("buildCompatibleProviderGroup", () => {
  it("shows a placeholder when no aliases or custom models exist", () => {
    const group = buildCompatibleProviderGroup({
      providerId: ANTHROPIC_COMPAT_ID,
      activeProviders,
      providerNodes,
      modelAliases: {},
      customModels: [],
      providerInfo: { name: ANTHROPIC_COMPAT_ID, color: "#666" },
    });

    expect(group.isCustom).toBe(true);
    expect(group.hasModels).toBe(false);
    expect(group.models).toHaveLength(1);
    expect(group.models[0]).toMatchObject({
      isPlaceholder: true,
      value: `${OPEN_CLAUDE_PREFIX}/model-id`,
    });
  });

  it("surfaces legacy alias-keyed models with the configured display prefix", () => {
    const modelAliases = {
      "open-claude-alias": `${ANTHROPIC_COMPAT_ID}/claude-3-5-sonnet`,
    };
    const group = buildCompatibleProviderGroup({
      providerId: ANTHROPIC_COMPAT_ID,
      activeProviders,
      providerNodes,
      modelAliases,
      customModels: [],
      providerInfo: { name: ANTHROPIC_COMPAT_ID, color: "#666" },
    });

    expect(group.hasModels).toBe(true);
    expect(group.models.map((m) => m.value)).toEqual([
      `${OPEN_CLAUDE_PREFIX}/claude-3-5-sonnet`,
    ]);
  });

  // The bug: imported models were stored in /api/models/custom with
  // providerAlias === providerId. The original code only looked at
  // modelAliases, so they were invisible to the combo picker.
  it("surfaces imported (custom) models for the compatible provider", () => {
    const customModels = [
      { providerAlias: ANTHROPIC_COMPAT_ID, id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet", type: "llm" },
      { providerAlias: ANTHROPIC_COMPAT_ID, id: "claude-3-haiku", name: "Claude 3 Haiku", type: "llm" },
    ];
    const group = buildCompatibleProviderGroup({
      providerId: ANTHROPIC_COMPAT_ID,
      activeProviders,
      providerNodes,
      modelAliases: {},
      customModels,
      providerInfo: { name: ANTHROPIC_COMPAT_ID, color: "#666" },
    });

    expect(group.hasModels).toBe(true);
    expect(group.models).toHaveLength(2);
    expect(group.models.map((m) => m.value)).toEqual([
      `${OPEN_CLAUDE_PREFIX}/claude-3-5-sonnet`,
      `${OPEN_CLAUDE_PREFIX}/claude-3-haiku`,
    ]);
    for (const m of group.models) expect(m.isCustom).toBe(true);
  });

  it("merges aliases and imported models without duplicating ids", () => {
    const modelAliases = {
      "Claude 3.5 Sonnet": `${ANTHROPIC_COMPAT_ID}/claude-3-5-sonnet`,
    };
    const customModels = [
      { providerAlias: ANTHROPIC_COMPAT_ID, id: "claude-3-5-sonnet", name: "dup", type: "llm" },
      { providerAlias: ANTHROPIC_COMPAT_ID, id: "claude-3-haiku", name: "Claude 3 Haiku", type: "llm" },
    ];
    const group = buildCompatibleProviderGroup({
      providerId: ANTHROPIC_COMPAT_ID,
      activeProviders,
      providerNodes,
      modelAliases,
      customModels,
      providerInfo: { name: ANTHROPIC_COMPAT_ID, color: "#666" },
    });

    const ids = group.models.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("claude-3-5-sonnet");
    expect(ids).toContain("claude-3-haiku");
  });

  it("ignores custom models from other providers", () => {
    const customModels = [
      { providerAlias: "anthropic-compatible-OTHER-uuid", id: "other-model", name: "x", type: "llm" },
      { providerAlias: "openai-compatible-yet-another", id: "y", name: "y", type: "llm" },
    ];
    const group = buildCompatibleProviderGroup({
      providerId: ANTHROPIC_COMPAT_ID,
      activeProviders,
      providerNodes,
      modelAliases: {},
      customModels,
      providerInfo: { name: ANTHROPIC_COMPAT_ID, color: "#666" },
    });

    expect(group.hasModels).toBe(false);
    expect(group.models[0].isPlaceholder).toBe(true);
  });
});

describe("buildGroupedModels — combo picker for compatible providers", () => {
  it("returns all imported anthropic-compatible models for combo configuration", () => {
    const customModels = [
      { providerAlias: ANTHROPIC_COMPAT_ID, id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet", type: "llm" },
      { providerAlias: ANTHROPIC_COMPAT_ID, id: "claude-3-haiku", name: "Claude 3 Haiku", type: "llm" },
      { providerAlias: ANTHROPIC_COMPAT_ID, id: "claude-3-opus", name: "Claude 3 Opus", type: "llm" },
    ];

    const groups = buildGroupedModels({ ...baseInput, customModels });

    expect(groups[ANTHROPIC_COMPAT_ID]).toBeDefined();
    expect(groups[ANTHROPIC_COMPAT_ID].name).toBe("open-claude");
    expect(groups[ANTHROPIC_COMPAT_ID].alias).toBe(OPEN_CLAUDE_PREFIX);
    expect(groups[ANTHROPIC_COMPAT_ID].isCustom).toBe(true);
    expect(groups[ANTHROPIC_COMPAT_ID].hasModels).toBe(true);

    const values = groups[ANTHROPIC_COMPAT_ID].models.map((m) => m.value).sort();
    expect(values).toEqual([
      `${OPEN_CLAUDE_PREFIX}/claude-3-5-sonnet`,
      `${OPEN_CLAUDE_PREFIX}/claude-3-haiku`,
      `${OPEN_CLAUDE_PREFIX}/claude-3-opus`,
    ]);
  });

  it("drops the compatible provider from groups when all its models are disabled", () => {
    const customModels = [
      { providerAlias: ANTHROPIC_COMPAT_ID, id: "claude-3-5-sonnet", name: "x", type: "llm" },
    ];
    const groups = buildGroupedModels({
      ...baseInput,
      customModels,
      disabledModels: { [ANTHROPIC_COMPAT_ID]: ["claude-3-5-sonnet"] },
    });
    expect(groups[ANTHROPIC_COMPAT_ID]).toBeUndefined();
  });

  it("omits the compatible provider when kindFilter is a typed media kind", () => {
    const customModels = [
      { providerAlias: ANTHROPIC_COMPAT_ID, id: "claude-3-5-sonnet", name: "x", type: "llm" },
    ];
    const groups = buildGroupedModels({
      ...baseInput,
      customModels,
      kindFilter: "image",
    });
    expect(groups[ANTHROPIC_COMPAT_ID]).toBeUndefined();
  });
});
