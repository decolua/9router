// T3.4 (T-D): the combo fallback skips a models.dev-retired member at the
// SAME decision point that drops a twice-unavailable one — and never when an
// account still lists it. Same mock harness as model-sync-combo.test.js.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCatalogLifecycle: vi.fn(() => null) }));

// The lifecycle reader, mocked (never touch a real DATA_DIR catalog file).
vi.mock("open-sse/providers/catalogOverride.js", () => ({
  getCatalogLifecycle: mocks.getCatalogLifecycle,
}));

vi.mock("@/lib/localDb", () => ({
  getModelAliases: vi.fn(async () => ({})),
  getComboByName: vi.fn(async () => null),
  getProviderNodes: vi.fn(async () => []),
  getProviderConnections: vi.fn(async () => []),
}));

import { getComboModels } from "../../src/sse/services/model.js";
import { getComboByName, getProviderConnections } from "@/lib/localDb";

beforeEach(() => {
  vi.clearAllMocks();
  getComboByName.mockImplementation(async () => null);
  getProviderConnections.mockImplementation(async () => []);
  mocks.getCatalogLifecycle.mockImplementation(() => null);
});

function installLifecycle(map) {
  mocks.getCatalogLifecycle.mockImplementation(
    (provider, model) => map[`${provider}/${model}`] || null
  );
}

function catalogConn(provider, models, id = `${provider}-1`) {
  return {
    id,
    provider,
    isActive: true,
    modelCatalog: { models, lastSuccessAt: new Date().toISOString(), lastAttemptAt: new Date().toISOString(), lastError: null },
  };
}

// A connection whose first sync failed: models[] without lastSuccessAt is NOT
// a catalogue (see connectionHasSyncedCatalog) — there is no account evidence.
function unsyncedConn(provider, id = `${provider}-1`) {
  return { id, provider, isActive: true, modelCatalog: { models: [], lastError: "boom" } };
}

describe("combo skip of models.dev-retired members", () => {
  it("skips a retired member no account lists, keeps the rest in stored order", async () => {
    getComboByName.mockResolvedValue({ name: "mix", models: ["claude/dead", "claude/live"] });
    getProviderConnections.mockResolvedValue([
      catalogConn("claude", [{ id: "live", availability: "available" }]),
    ]);
    installLifecycle({ "claude/dead": "retired" });
    expect(await getComboModels("mix")).toEqual(["claude/live"]);
  });

  it("skips it even when some account exists but has never synced", async () => {
    getComboByName.mockResolvedValue({ name: "mix", models: ["claude/dead", "claude/live"] });
    getProviderConnections.mockResolvedValue([unsyncedConn("claude")]);
    installLifecycle({ "claude/dead": "retired" });
    expect(await getComboModels("mix")).toEqual(["claude/live"]);
  });

  it("a synced catalogue that still lists the retired model beats the feed", async () => {
    getComboByName.mockResolvedValue({ name: "mix", models: ["claude/dead", "claude/live"] });
    getProviderConnections.mockResolvedValue([
      catalogConn("claude", [
        { id: "dead", availability: "available" },
        { id: "live", availability: "available" },
      ]),
    ]);
    installLifecycle({ "claude/dead": "retired" });
    expect(await getComboModels("mix")).toEqual(["claude/dead", "claude/live"]);
  });

  it("temporarily-absent still counts as the account listing it", async () => {
    getComboByName.mockResolvedValue({ name: "mix", models: ["claude/dead"] });
    getProviderConnections.mockResolvedValue([
      catalogConn("claude", [{ id: "dead", availability: "temporarily-absent", missingSyncs: 1 }]),
    ]);
    installLifecycle({ "claude/dead": "retired" });
    expect(await getComboModels("mix")).toEqual(["claude/dead"]);
  });

  it("deprecated/alpha members are never skipped by the feed", async () => {
    getComboByName.mockResolvedValue({ name: "mix", models: ["claude/dep", "claude/alpha-one"] });
    getProviderConnections.mockResolvedValue([
      catalogConn("claude", [{ id: "other", availability: "available" }]),
    ]);
    installLifecycle({ "claude/dep": "deprecated", "claude/alpha-one": "alpha" });
    expect(await getComboModels("mix")).toEqual(["claude/dep", "claude/alpha-one"]);
  });

  it("passthrough providers keep ids their listing never knew", async () => {
    // bai is passthroughModels: true in the registry.
    getComboByName.mockResolvedValue({ name: "mix", models: ["bai/dead"] });
    getProviderConnections.mockResolvedValue([
      catalogConn("bai", [{ id: "other", availability: "available" }]),
    ]);
    installLifecycle({ "bai/dead": "retired" });
    expect(await getComboModels("mix")).toEqual(["bai/dead"]);
  });

  it("fail-open: a combo whose every member the feed retired still routes", async () => {
    getComboByName.mockResolvedValue({ name: "mix", models: ["claude/dead", "claude/ghost"] });
    getProviderConnections.mockResolvedValue([
      catalogConn("claude", [{ id: "other", availability: "available" }]),
    ]);
    // The reader already collapses raw "eol"/"shutdown" to the normalized
    // "retired" (see t34-lifecycle-catalog) — the mock speaks normalized too.
    installLifecycle({ "claude/dead": "retired", "claude/ghost": "retired" });
    expect(await getComboModels("mix")).toEqual(["claude/dead", "claude/ghost"]);
  });

  it("regression: the twice-unavailable rule still works untouched", async () => {
    getComboByName.mockResolvedValue({ name: "mix", models: ["claude/old", "claude/new"] });
    getProviderConnections.mockResolvedValue([
      catalogConn("claude", [
        { id: "old", availability: "unavailable", missingSyncs: 2 },
        { id: "new", availability: "available", missingSyncs: 0 },
      ]),
    ]);
    expect(await getComboModels("mix")).toEqual(["claude/new"]);
  });
});
