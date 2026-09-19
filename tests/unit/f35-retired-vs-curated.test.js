// F35 (follow-up REV-B nit 3, T3.4 hide-retired): status de modelos não pode
// esconder o que uma conta ainda serve. An active account's curated
// enabledModels IS listing evidence for the models.dev "retired" suppression —
// in /v1/models AND in the combo fallback — even when that account never
// synced a catalogue and the live /models fetch is skipped (the dashboard's
// internal fetch sends x-9r-internal-models-fetch, so c4909e08's "live"
// evidence silently vanished for curated accounts). Conservative rule intact:
// feed retired + NO account listing it (catalogue or curation) = hidden.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
  getComboByName: vi.fn(),
  getProviderNodes: vi.fn(),
  getProviderConnectionById: vi.fn(),
  getDisabledModels: vi.fn(),
  getCatalogLifecycle: vi.fn(() => null),
  getCatalogCost: vi.fn(() => null),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getCombos: mocks.getCombos,
  getCustomModels: mocks.getCustomModels,
  getModelAliases: mocks.getModelAliases,
  getComboByName: mocks.getComboByName,
  getProviderNodes: mocks.getProviderNodes,
  getProviderConnectionById: mocks.getProviderConnectionById,
}));

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: mocks.getDisabledModels,
}));

vi.mock("open-sse/providers/catalogOverride.js", () => ({
  getCatalogCost: mocks.getCatalogCost,
  getCatalogLifecycle: mocks.getCatalogLifecycle,
}));

vi.mock("open-sse/services/kiroModels.js", () => ({ resolveKiroModels: vi.fn(async () => null) }));
vi.mock("open-sse/services/kimchiModels.js", () => ({ resolveKimchiModels: vi.fn(async () => null) }));
vi.mock("open-sse/services/qoderModels.js", () => ({ resolveQoderModels: vi.fn(async () => null), routableQoderModels: vi.fn(async () => null) }));
vi.mock("open-sse/services/copilotModels.js", () => ({ resolveCopilotModels: vi.fn(async () => null) }));
vi.mock("open-sse/services/clinepassModels.js", () => ({ resolveClinepassModels: vi.fn(async () => null), resolveClineModels: vi.fn(async () => null) }));
vi.mock("open-sse/services/grokCliModels.js", () => ({ resolveGrokCliModels: vi.fn(async () => null) }));
vi.mock("open-sse/services/cursorModels.js", () => ({ resolveCursorModels: vi.fn(async () => null) }));
vi.mock("open-sse/shared/zedAuth.js", () => ({ resolveZedModels: vi.fn(async () => null) }));
vi.mock("@/sse/services/tokenRefresh", () => ({ updateProviderCredentials: vi.fn(async () => {}) }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));

import { buildModelsList } from "../../src/app/api/v1/models/route.js";
import { getComboModels } from "../../src/sse/services/model.js";
import { PROVIDER_ID_TO_ALIAS, PROVIDER_MODELS } from "@/shared/constants/models";

function conn(provider, overrides = {}) {
  return {
    id: `${provider}-${Math.random().toString(36).slice(2, 6)}`,
    provider,
    isActive: true,
    providerSpecificData: {},
    modelCatalog: null,
    ...overrides,
  };
}

function catalog(models) {
  return {
    models: models.map((m) => (typeof m === "string" ? { id: m, tier: "unknown", availability: "available" } : m)),
    lastSuccessAt: new Date().toISOString(),
    lastAttemptAt: new Date().toISOString(),
    lastError: null,
  };
}

// Mirrors the real reader's base-id fallback (the file is keyed by baseId).
function installLifecycle(map) {
  mocks.getCatalogLifecycle.mockImplementation((provider, model) => {
    const bare = String(model || "").includes("/") ? String(model).split("/").pop() : model;
    return map[`${provider}/${model}`] || map[`${provider}/${bare}`] || null;
  });
}

function entry(list, id) {
  return list.find((m) => m.id === id);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProviderConnections.mockResolvedValue([]);
  mocks.getCombos.mockResolvedValue([]);
  mocks.getCustomModels.mockResolvedValue([]);
  mocks.getModelAliases.mockResolvedValue({});
  mocks.getComboByName.mockResolvedValue(null);
  mocks.getProviderNodes.mockResolvedValue([]);
  mocks.getDisabledModels.mockResolvedValue({});
  installLifecycle({});
});

describe("F35 /v1/models: curated enabledModels is listing evidence", () => {
  it("keeps a feed-retired id curated by an account that never synced (RED case)", async () => {
    // Today's loss: catalogue-less active account, curated ids on purpose, and
    // the internal dashboard fetch (skipDynamicFetch) removes the /models
    // path too — the retired feed silently hid what the account still serves.
    mocks.getProviderConnections.mockResolvedValue([
      conn("openai", { providerSpecificData: { enabledModels: ["dead-200k", "fine"] } }),
    ]);
    installLifecycle({ "openai/dead-200k": "retired" });
    const all = await buildModelsList(["llm"], { skipDynamicFetch: true });
    const e = entry(all, "openai/dead-200k");
    expect(e).toBeTruthy();
    expect(e.lifecycle).toBe("retired"); // annotated, not hidden
    expect(entry(all, "openai/fine")).toBeTruthy();
  });

  it("one account's curation survives ANOTHER account's `unavailable` (union)", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      conn("openai", { id: "a", providerSpecificData: { enabledModels: ["dead-200k"] } }),
      conn("openai", { id: "b", modelCatalog: catalog([{ id: "dead-200k", availability: "unavailable" }]) }),
    ]);
    installLifecycle({ "openai/dead-200k": "retired" });
    const e = entry(await buildModelsList(["llm"], { skipDynamicFetch: true }), "openai/dead-200k");
    expect(e).toBeTruthy();
    expect(e.lifecycle).toBe("retired");
  });

  it("conservative: the SAME account's `unavailable` entry revokes its curation", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      conn("openai", {
        providerSpecificData: { enabledModels: ["dead-200k"] },
        modelCatalog: catalog([{ id: "dead-200k", availability: "unavailable" }]),
      }),
    ]);
    installLifecycle({ "openai/dead-200k": "retired" });
    const ids = (await buildModelsList(["llm"], { skipDynamicFetch: true })).map((m) => m.id);
    expect(ids).not.toContain("openai/dead-200k");
  });

  it("non-vacuity: retired id NO account lists stays hidden (static seed, no connections)", async () => {
    const providerId = "claude";
    const alias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
    const list = (PROVIDER_MODELS[alias] || []).filter((m) => !m.type && !m.kind);
    expect(list.length).toBeGreaterThan(0);
    const [victim] = list;
    installLifecycle({ [`${providerId}/${victim.id}`]: "retired" });
    mocks.getProviderConnections.mockResolvedValue([]);
    const ids = (await buildModelsList(["llm"])).map((m) => m.id);
    expect(ids).not.toContain(`${alias}/${victim.id}`);
  });
});

describe("F35 combo fallback: curated enabledModels keeps a retired member", () => {
  it("a retired member curated by an unsynced account survives the filter", async () => {
    mocks.getComboByName.mockResolvedValue({ name: "mix", models: ["claude/dead", "claude/other"] });
    mocks.getProviderConnections.mockResolvedValue([
      conn("claude", { id: "claude-a", providerSpecificData: { enabledModels: ["dead"] } }),
    ]);
    installLifecycle({ "claude/dead": "retired" });
    expect(await getComboModels("mix")).toEqual(["claude/dead", "claude/other"]);
  });

  it("non-vacuity: no curation and no catalogue — the retired member is still skipped", async () => {
    mocks.getComboByName.mockResolvedValue({ name: "mix", models: ["claude/dead", "claude/other"] });
    // Failed first sync: empty models[] without lastSuccessAt is not a
    // catalogue and there is no curated list — nothing lists "dead".
    mocks.getProviderConnections.mockResolvedValue([
      { id: "claude-a", provider: "claude", isActive: true, modelCatalog: { models: [], lastError: "boom" } },
    ]);
    installLifecycle({ "claude/dead": "retired" });
    expect(await getComboModels("mix")).toEqual(["claude/other"]);
  });

  it("conservative: the member's curation revoked by that same account's unavailable catalogue still skips", async () => {
    mocks.getComboByName.mockResolvedValue({ name: "mix", models: ["claude/dead", "claude/live"] });
    mocks.getProviderConnections.mockResolvedValue([
      conn("claude", {
        providerSpecificData: { enabledModels: ["dead"] },
        modelCatalog: catalog([
          { id: "dead", availability: "unavailable", missingSyncs: 2 },
          { id: "live", availability: "available" },
        ]),
      }),
    ]);
    installLifecycle({ "claude/dead": "retired" });
    expect(await getComboModels("mix")).toEqual(["claude/live"]);
  });
});
