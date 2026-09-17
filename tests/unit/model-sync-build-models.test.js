import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock all localDb access used by buildModelsList + getComboModels
const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
  getComboByName: vi.fn(),
  getProviderNodes: vi.fn(),
  getProviderConnectionById: vi.fn(),
  getDisabledModels: vi.fn(),
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
// catalogOverride: no models.dev overlay by default
vi.mock("open-sse/providers/catalogOverride.js", () => ({
  getCatalogCost: vi.fn(() => null),
}));

// Live resolvers — keep null unless test needs them
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
import { getProviderConnections } from "@/lib/localDb";
import { getComboModels } from "../../src/sse/services/model.js";
import { getComboByName } from "@/lib/localDb";

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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProviderConnections.mockResolvedValue([]);
  mocks.getCombos.mockResolvedValue([]);
  mocks.getCustomModels.mockResolvedValue([]);
  mocks.getModelAliases.mockResolvedValue({});
  mocks.getDisabledModels.mockResolvedValue({});
});

describe("B2: /v1/models/free via buildModelsList tier filter", () => {
  it("advertises only tier=free models when caller filters downstream", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      conn("bai", {
        modelCatalog: catalog([
          { id: "free-model", tier: "free", availability: "available", pricing: { prompt: 0, completion: 0 } },
          { id: "paid-model", tier: "paid", availability: "available", pricing: { prompt: 0.01, completion: 0.03 } },
        ]),
      }),
    ]);
    const all = await buildModelsList(["llm"]);
    const freeOnly = all.filter((m) => m.tier === "free");
    expect(all.map((m) => m.id)).toEqual(expect.arrayContaining(["bai/free-model", "bai/paid-model"]));
    expect(freeOnly.map((m) => m.id)).toEqual(["bai/free-model"]);
    expect(freeOnly[0].tier).toBe("free");
    // Route-level free filter is a thin wrapper; this proves the data it relies on is emitted.
  });

  it("keeps free-model visible even when models.dev would say unknown — synced tier wins", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      conn("bai", {
        modelCatalog: catalog([{ id: "m1", tier: "free", availability: "available" }]),
      }),
    ]);
    const all = await buildModelsList(["llm"]);
    expect(all.find((m) => m.id === "bai/m1")?.tier).toBe("free");
  });
});

describe("B2: união multi-conta com dedup correto (free wins)", () => {
  it("dedups by id across accounts of the same provider and keeps free tier when any account lists it as free", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      conn("bai", { id: "bai-a", modelCatalog: catalog([{ id: "shared", tier: "paid", availability: "available" }]) }),
      conn("bai", { id: "bai-b", modelCatalog: catalog([{ id: "shared", tier: "free", availability: "available" }]) }),
    ]);
    const all = await buildModelsList(["llm"]);
    const shared = all.filter((m) => m.id === "bai/shared");
    expect(shared).toHaveLength(1);
    expect(shared[0].tier).toBe("free");
  });

  it("lets paid/credits overwrite a prior unknown tier across accounts", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      conn("bai", { id: "bai-a", modelCatalog: catalog([{ id: "shared", tier: "unknown", availability: "available" }]) }),
      conn("bai", { id: "bai-b", modelCatalog: catalog([{ id: "shared", tier: "paid", availability: "available", pricing: { prompt: 0.01, completion: 0.02 } }]) }),
    ]);
    const all = await buildModelsList(["llm"]);
    expect(all.find((m) => m.id === "bai/shared")?.tier).toBe("paid");
  });

  it("does not let paid overwrite an existing free tier", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      conn("bai", { id: "bai-a", modelCatalog: catalog([{ id: "shared", tier: "free", availability: "available" }]) }),
      conn("bai", { id: "bai-b", modelCatalog: catalog([{ id: "shared", tier: "paid", availability: "available" }]) }),
    ]);
    const all = await buildModelsList(["llm"]);
    expect(all.find((m) => m.id === "bai/shared")?.tier).toBe("free");
  });

  it("single-appearance model is emitted once regardless of account count", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      conn("bai", { id: "bai-a", modelCatalog: catalog([{ id: "only-a", tier: "paid", availability: "available" }]) }),
      conn("bai", { id: "bai-b", modelCatalog: catalog([{ id: "only-b", tier: "free", availability: "available" }]) }),
    ]);
    const all = await buildModelsList(["llm"]);
    expect(all.map((m) => m.id)).toEqual(expect.arrayContaining(["bai/only-a", "bai/only-b"]));
    expect(all.filter((m) => m.id === "bai/only-a")).toHaveLength(1);
    expect(all.filter((m) => m.id === "bai/only-b")).toHaveLength(1);
  });

  it("unavailable on every account hides the model from discovery", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      conn("bai", { id: "bai-a", modelCatalog: { models: [{ id: "gone", tier: "paid", availability: "unavailable" }], lastSuccessAt: new Date().toISOString(), lastAttemptAt: new Date().toISOString(), lastError: null } }),
      conn("bai", { id: "bai-b", modelCatalog: { models: [{ id: "gone", tier: "paid", availability: "unavailable" }], lastSuccessAt: new Date().toISOString(), lastAttemptAt: new Date().toISOString(), lastError: null } }),
    ]);
    const all = await buildModelsList(["llm"]);
    expect(all.map((m) => m.id)).not.toContain("bai/gone");
  });

  it("unavailable on one account but available on another keeps it advertised", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      conn("bai", { id: "bai-a", modelCatalog: { models: [{ id: "keep", tier: "paid", availability: "unavailable" }], lastSuccessAt: new Date().toISOString(), lastAttemptAt: new Date().toISOString(), lastError: null } }),
      conn("bai", { id: "bai-b", modelCatalog: catalog([{ id: "keep", tier: "paid", availability: "available" }]) }),
    ]);
    const all = await buildModelsList(["llm"]);
    expect(all.map((m) => m.id)).toContain("bai/keep");
  });
});

describe("B2: todos indisponíveis — o combo salvo é roteado mesmo assim", () => {
  it("combo with all members unavailable still routes (real provider error beats a synthetic 503)", async () => {
    vi.mocked(getProviderConnections).mockResolvedValue([
      { id: "bai-1", provider: "bai", isActive: true, modelCatalog: { models: [{ id: "dead-a", availability: "unavailable" }, { id: "dead-b", availability: "unavailable" }], lastSuccessAt: new Date().toISOString(), lastError: null } },
    ]);
    vi.mocked(getComboByName).mockResolvedValue({ name: "dead-combo", models: ["bai/dead-a", "bai/dead-b"] });
    const members = await getComboModels("dead-combo");
    // An empty list would reach handleComboChat as a truthy [] and 503 without
    // calling any provider — the catalog sync must not be able to do that.
    expect(members).toEqual(["bai/dead-a", "bai/dead-b"]);
  });

  it("combo with one temporarily-absent member still routes (no false 503)", async () => {
    vi.mocked(getProviderConnections).mockResolvedValue([
      { id: "bai-1", provider: "bai", isActive: true, modelCatalog: { models: [{ id: "wobbly", availability: "temporarily-absent" }], lastSuccessAt: new Date().toISOString(), lastError: null } },
    ]);
    vi.mocked(getComboByName).mockResolvedValue({ name: "ok-combo", models: ["bai/wobbly"] });
    const members = await getComboModels("ok-combo");
    expect(members).toEqual(["bai/wobbly"]);
  });
});
