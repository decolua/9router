import { beforeEach, describe, expect, it, vi } from "vitest";

// F11: /v1/models must aggregate providerSpecificData.enabledModels across
// EVERY active account of a provider (multi-account union,
// docs/MODEL_SYNC_CATALOG.md: "a model stays advertised while ANY active
// account of that provider still lists it as available"). Before the fix
// only the FIRST active connection's enabledModels was consulted, so models
// curated only on account 2 never surfaced, and per-account catalog
// availability (unavailable/temporarily-absent) was never applied to the
// curated list.

// Mock all localDb access used by buildModelsList (same harness as
// model-sync-build-models.test.js).
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

function curatedAccount(id, enabledModels, catalogModels) {
  return conn("bai", {
    id,
    providerSpecificData: { enabledModels },
    modelCatalog: catalogModels ? catalog(catalogModels) : null,
  });
}

function ids(list) {
  return list.map((m) => m.id);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProviderConnections.mockResolvedValue([]);
  mocks.getCombos.mockResolvedValue([]);
  mocks.getCustomModels.mockResolvedValue([]);
  mocks.getModelAliases.mockResolvedValue({});
  mocks.getDisabledModels.mockResolvedValue({});
});

describe("F11: enabledModels union across all active accounts", () => {
  it("lists the union of two accounts' curated lists (A,B + B,C -> A,B,C, once each)", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      curatedAccount("bai-1", ["A", "B"]),
      curatedAccount("bai-2", ["B", "C"]),
    ]);
    const all = await buildModelsList(["llm"]);
    const listed = ids(all);
    expect(listed).toEqual(expect.arrayContaining(["bai/A", "bai/B", "bai/C"]));
    expect(listed.filter((id) => id === "bai/B")).toHaveLength(1);
    // C comes only from account 2 — this is the core of the bug (first-connection-only).
    expect(listed).toContain("bai/C");
  });

  it("keeps a curated model unavailable on one account but available on another", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      curatedAccount("bai-1", ["gone1", "kept"], [
        { id: "gone1", availability: "unavailable" },
        { id: "kept", availability: "available" },
      ]),
      curatedAccount("bai-2", ["gone1"], [
        { id: "gone1", availability: "available" },
      ]),
    ]);
    const all = await buildModelsList(["llm"]);
    expect(ids(all)).toContain("bai/gone1");
    expect(ids(all)).toContain("bai/kept");
  });

  it("hides a curated model only when every account that lists it confirms unavailable", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      curatedAccount("bai-1", ["hidden1"], [
        { id: "hidden1", availability: "unavailable" },
      ]),
      curatedAccount("bai-2", ["hidden1"], [
        { id: "hidden1", availability: "unavailable" },
      ]),
    ]);
    const all = await buildModelsList(["llm"]);
    expect(ids(all)).not.toContain("bai/hidden1");
  });

  it("keeps a temporarily-absent curated model advertised (one absence is not removal)", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      curatedAccount("bai-1", ["wobbly"], [
        { id: "wobbly", availability: "temporarily-absent" },
      ]),
    ]);
    const all = await buildModelsList(["llm"]);
    expect(ids(all)).toContain("bai/wobbly");
  });

  it("an account with no enabledModels and no catalog does not crash nor hide the other account's models", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      curatedAccount("bai-1", ["A", "B"]),
      conn("bai", { id: "bai-2", providerSpecificData: {}, modelCatalog: null }),
    ]);
    const all = await buildModelsList(["llm"]);
    expect(ids(all)).toEqual(expect.arrayContaining(["bai/A", "bai/B"]));
  });

  it("a catalog-only sibling (no curation) still contributes its available models to a curated provider", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      curatedAccount("bai-1", ["A"]),
      conn("bai", { id: "bai-2", modelCatalog: catalog([{ id: "B", tier: "unknown", availability: "available" }]) }),
    ]);
    const all = await buildModelsList(["llm"]);
    expect(ids(all)).toEqual(expect.arrayContaining(["bai/A", "bai/B"]));
  });

  it("curated list stays curated: ids no account lists are not advertised", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      curatedAccount("bai-1", ["A"]),
      curatedAccount("bai-2", ["B"]),
    ]);
    const all = await buildModelsList(["llm"]);
    expect(ids(all)).not.toContain("bai/C");
  });
});
