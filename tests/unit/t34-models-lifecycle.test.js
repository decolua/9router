// T3.4 (T-D): /v1/models lifecycle behaviour. Same harness as
// f11-models-union.test.js (multi-account union — untouched rules verified
// still intact), plus the models.dev lifecycle layer:
//  - retired/EOL is hidden ONLY while no live account lists it — "listing"
//    counts a synced catalogue AND the account's curated enabledModels (F35);
//  - retired-with-live-account stays and gains the metadata;
//  - deprecated/alpha/beta always stay and gain the metadata;
//  - user-declared custom/alias ids are never feed-revoked.
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

// The lifecycle vocabulary under test; no models.dev cost overlay by default.
vi.mock("open-sse/providers/catalogOverride.js", () => ({
  getCatalogCost: vi.fn(() => null),
  getCatalogLifecycle: mocks.getCatalogLifecycle,
}));

vi.mock("open-sse/services/kiroModels.js", () => ({ resolveKiroModels: vi.fn(async () => null) }));
vi.mock("open-sse/services/kimchiModels.js", () => ({ resolveKimchiModels: vi.fn(async () => null) }));
vi.mock("open-sse/services/qoderModels.js", () => ({ resolveQoderModels: vi.fn(async () => null) }));
vi.mock("open-sse/services/copilotModels.js", () => ({ resolveCopilotModels: vi.fn(async () => null) }));
vi.mock("open-sse/services/clinepassModels.js", () => ({ resolveClinepassModels: vi.fn(async () => null) }));
vi.mock("open-sse/services/grokCliModels.js", () => ({ resolveGrokCliModels: vi.fn(async () => null) }));
vi.mock("open-sse/services/cursorModels.js", () => ({ resolveCursorModels: vi.fn(async () => null) }));
vi.mock("open-sse/shared/zedAuth.js", () => ({ resolveZedModels: vi.fn(async () => null) }));
vi.mock("@/sse/services/tokenRefresh", () => ({ updateProviderCredentials: vi.fn(async () => {}) }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));

import { buildModelsList } from "../../src/app/api/v1/models/route.js";
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

// Teach the mocked reader: `installLifecycle({ "bai/dead": "retired" })`.
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
  mocks.getDisabledModels.mockResolvedValue({});
  installLifecycle({});
});

describe("lifecycle: curated list, no synced catalogue", () => {
  // F35 (REV-B nit 3) reversed this case's expectation: an active account's
  // curated enabledModels IS listing evidence (the user activated the id on
  // purpose), so the retired feed may only annotate it, never hide it. The
  // conservative rule stands: retired + NO account listing it = hidden.
  it("keeps a retired id the account curated, annotating deprecated/alpha too", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      conn("bai", { providerSpecificData: { enabledModels: ["dead", "dep", "alpha-one", "fine"] } }),
    ]);
    installLifecycle({
      "bai/dead": "retired",
      "bai/dep": "deprecated",
      "bai/alpha-one": "alpha",
    });
    const all = await buildModelsList(["llm"]);
    expect(entry(all, "bai/dead").lifecycle).toBe("retired");
    expect(entry(all, "bai/dep").lifecycle).toBe("deprecated");
    expect(entry(all, "bai/alpha-one").lifecycle).toBe("alpha");
    expect("lifecycle" in entry(all, "bai/fine")).toBe(false);
  });
});

describe("lifecycle vs live account evidence (account wins over the feed)", () => {
  it("keeps a retired model an account still lists as available", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      conn("bai", { modelCatalog: catalog([
        { id: "dead", availability: "available" },
        { id: "other", availability: "available" },
      ]) }),
    ]);
    installLifecycle({ "bai/dead": "retired" });
    const all = await buildModelsList(["llm"]);
    const e = entry(all, "bai/dead");
    expect(e).toBeTruthy();
    expect(e.lifecycle).toBe("retired");
  });

  it("temporarily-absent still counts as live evidence", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      conn("bai", { modelCatalog: catalog([{ id: "dead", availability: "temporarily-absent" }]) }),
    ]);
    installLifecycle({ "bai/dead": "retired" });
    expect(entry(await buildModelsList(["llm"]), "bai/dead")).toBeTruthy();
  });

  it("union: retired and unavailable on account A but available on account B stays", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      conn("bai", { id: "a", modelCatalog: catalog([{ id: "dead", availability: "unavailable" }]) }),
      conn("bai", { id: "b", modelCatalog: catalog([{ id: "dead", availability: "available" }]) }),
    ]);
    installLifecycle({ "bai/dead": "retired" });
    expect(entry(await buildModelsList(["llm"]), "bai/dead")).toBeTruthy();
  });

  it("gateway-prefixed catalogue ids count as evidence for the bare model", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      conn("orcarouter", { modelCatalog: catalog([{ id: "anthropic/dead-sonnet", availability: "available" }]) }),
    ]);
    installLifecycle({ "orcarouter/dead-sonnet": "retired" });
    const e = entry(await buildModelsList(["llm"]), "orcarouter/anthropic/dead-sonnet");
    expect(e).toBeTruthy();
    expect(e.lifecycle).toBe("retired");
  });
});

describe("lifecycle never revokes user declarations", () => {
  it("keeps a custom model even when the feed marks that id retired", async () => {
    mocks.getProviderConnections.mockResolvedValue([conn("bai")]);
    mocks.getCustomModels.mockResolvedValue([{ id: "dead", providerAlias: "bai" }]);
    installLifecycle({ "bai/dead": "retired" });
    expect(entry(await buildModelsList(["llm"]), "bai/dead")).toBeTruthy();
  });
});

describe("lifecycle on the static seed (no connections at all)", () => {
  it("retired static models stop being advertised; deprecated ones gain metadata", async () => {
    // Pick two LLM entries from a real provider in the hand-written table.
    const providerId = "claude";
    const alias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
    const list = (PROVIDER_MODELS[alias] || []).filter((m) => !m.type && !m.kind);
    expect(list.length).toBeGreaterThan(1);
    const [victim, witness] = list;
    installLifecycle({
      [`${providerId}/${victim.id}`]: "retired",
      [`${providerId}/${witness.id}`]: "deprecated",
    });
    mocks.getProviderConnections.mockResolvedValue([]);
    const all = await buildModelsList(["llm"]);
    const ids = all.map((m) => m.id);
    expect(ids).not.toContain(`${alias}/${victim.id}`);
    expect(entry(all, `${alias}/${witness.id}`).lifecycle).toBe("deprecated");
  });
});

describe("F11 regression under the lifecycle layer", () => {
  it("feed abstention (no lifecycle data) leaves the union exactly as before", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      conn("bai", { id: "a", providerSpecificData: { enabledModels: ["A", "B"] } }),
      conn("bai", { id: "b", providerSpecificData: { enabledModels: ["B", "C"] } }),
    ]);
    const ids = (await buildModelsList(["llm"])).map((m) => m.id);
    expect(ids).toContain("bai/A");
    expect(ids).toContain("bai/B");
    expect(ids).toContain("bai/C");
    expect(ids.filter((id) => id === "bai/B")).toHaveLength(1);
    expect((await buildModelsList(["llm"])).every((m) => !("lifecycle" in m))).toBe(true);
  });
});
