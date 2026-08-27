/**
 * Free-model auto-discovery sync.
 *
 * Covers:
 *   - config normalization (interval whitelist, enabled coercion, combo ids)
 *   - sync target selection (free/freeTier + modelsFetcher with known filter)
 *   - a full runFreeModelSync pass against mocked upstream catalogs:
 *       persistence, custom-model add/remove diffing, auto-combo rewrite
 *   - buildModelsList exposure: synced free-provider models are listed even
 *     when the provider has no stored connection; disabled ids stay hidden
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── In-memory DB backing for everything the service touches ────────────────

const state = {
  settings: {},
  freeModels: {}, // providerId -> {ids, updatedAt}
  customModels: new Map(), // "alias|id|type" -> model
  combos: new Map(), // id -> combo
};

function resetState() {
  state.settings = { freeModelSync: { enabled: true, intervalHours: 4, autoComboIds: [] } };
  state.freeModels = {};
  state.customModels = new Map();
  state.combos = new Map();
}

vi.mock("@/lib/localDb", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getSettings: async () => state.settings,
    getFreeModels: async () => JSON.parse(JSON.stringify(state.freeModels)),
    getFreeModelsForProvider: async (providerId) => {
      const entry = state.freeModels[providerId];
      return entry ? JSON.parse(JSON.stringify(entry)) : null;
    },
    setFreeModels: async (providerId, ids) => {
      if (!Array.isArray(ids) || ids.length === 0) {
        delete state.freeModels[providerId];
        return;
      }
      state.freeModels[providerId] = { ids: [...new Set(ids)], updatedAt: new Date().toISOString() };
    },
    addCustomModel: async ({ providerAlias, id, type = "llm", name }) => {
      const k = `${providerAlias}|${id}|${type}`;
      if (state.customModels.has(k)) return false;
      state.customModels.set(k, { providerAlias, id, type, name: name || id });
      return true;
    },
    deleteCustomModel: async ({ providerAlias, id, type = "llm" }) => {
      state.customModels.delete(`${providerAlias}|${id}|${type}`);
    },
    getComboById: async (id) => {
      const c = state.combos.get(id);
      return c ? JSON.parse(JSON.stringify(c)) : null;
    },
    updateCombo: async (id, data) => {
      const c = state.combos.get(id);
      if (!c) return null;
      Object.assign(c, JSON.parse(JSON.stringify(data)));
      return c;
    },
  };
});

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: async () => state.disabledByAlias || {},
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function jsonResponse(data, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => data };
}

// Upstream catalog fixtures, keyed by URL substring.
const CATALOGS = {
  "opencode.ai/zen/v1/models": () =>
    jsonResponse({
      data: [
        { id: "x-preview-f-free", object: "model", owned_by: "opencode" },
        { id: "deepseek-v4-flash-free", object: "model", owned_by: "opencode" },
        { id: "gpt-5.6-sol", object: "model", owned_by: "opencode" }, // paid → filtered out
      ],
    }),
  "openrouter.ai/api/v1/models": () =>
    jsonResponse({
      data: [
        { id: "google/gemma-x:free", name: "Gemma X", pricing: { prompt: "0", completion: "0" }, context_length: 1000000 },
        { id: "tiny/small:free", pricing: { prompt: "0", completion: "0" }, context_length: 8192 }, // <200k ctx → filtered
        { id: "paid/model", pricing: { prompt: "0.001", completion: "0.002" }, context_length: 200000 }, // paid → filtered
      ],
    }),
  "models.dev/api.json": () =>
    jsonResponse([
      { id: "mimo-v2.5", name: "MiMo v2.5" },
      { id: "unrelated-model", name: "Other" },
    ]),
};

beforeEach(() => {
  resetState();
  state.disabledByAlias = {};
  fetchMock.mockReset();
  fetchMock.mockImplementation((url) => {
    const hit = Object.keys(CATALOGS).find((frag) => String(url).includes(frag));
    if (!hit) return jsonResponse({ data: [] });
    return CATALOGS[hit]();
  });
});

afterEach(() => {
  vi.resetModules();
});

describe("normalizeFreeModelSyncConfig", () => {
  it("defaults to disabled / 4h / no combos on empty input", async () => {
    const { normalizeFreeModelSyncConfig } = await import("../../src/shared/services/freeModelSync.js");
    expect(normalizeFreeModelSyncConfig()).toEqual({ enabled: false, intervalHours: 4, autoComboIds: [] });
  });

  it("coerces enabled to boolean and rejects non-whitelisted intervals", async () => {
    const { normalizeFreeModelSyncConfig } = await import("../../src/shared/services/freeModelSync.js");
    expect(normalizeFreeModelSyncConfig({ enabled: "yes", intervalHours: 1 })).toEqual({
      enabled: false,
      intervalHours: 4,
      autoComboIds: [],
    });
    expect(normalizeFreeModelSyncConfig({ enabled: true, intervalHours: 12 }).intervalHours).toBe(12);
    expect(normalizeFreeModelSyncConfig({ enabled: true, intervalHours: 24 }).intervalHours).toBe(24);
  });

  it("keeps only string combo ids", async () => {
    const { normalizeFreeModelSyncConfig } = await import("../../src/shared/services/freeModelSync.js");
    const cfg = normalizeFreeModelSyncConfig({ enabled: true, intervalHours: 8, autoComboIds: ["a", 5, null, "b"] });
    expect(cfg.autoComboIds).toEqual(["a", "b"]);
  });
});

describe("getSyncTargets", () => {
  it("selects free/freeTier providers that expose a filterable modelsFetcher", async () => {
    const { getSyncTargets } = await import("../../src/shared/services/freeModelSync.js");
    const ids = getSyncTargets().map((t) => t.id);
    expect(ids).toContain("opencode");
    expect(ids).toContain("openrouter");
    expect(ids).toContain("mimo-free");
  });

  it("excludes apikey-category providers even when they ship modelsFetcher", async () => {
    const { getSyncTargets } = await import("../../src/shared/services/freeModelSync.js");
    const ids = getSyncTargets().map((t) => t.id);
    expect(ids).not.toContain("venice");
    expect(ids).not.toContain("tokenrouter");
    expect(ids).not.toContain("perplexity-agent");
    expect(ids).not.toContain("kilocode"); // oauth category
  });

  it("orders targets by registry priority (openrouter before opencode)", async () => {
    const { getSyncTargets } = await import("../../src/shared/services/freeModelSync.js");
    const ids = getSyncTargets().map((t) => t.id);
    expect(ids.indexOf("openrouter")).toBeLessThan(ids.indexOf("opencode"));
  });
});

describe("runFreeModelSync", () => {
  it("persists filtered catalogs, diffs customs and rewrites auto-combos", async () => {
    // Previous snapshot: opencode had one now-vanished model.
    state.freeModels.opencode = { ids: ["deepseek-v4-flash-free", "vanished-old"], updatedAt: "2026-01-01T00:00:00Z" };
    state.settings.freeModelSync.autoComboIds = ["combo-1"];
    state.combos.set("combo-1", { id: "combo-1", name: "Free-All", kind: null, models: ["oc/vanished-old"] });

    const { runFreeModelSync } = await import("../../src/shared/services/freeModelSync.js");
    const result = await runFreeModelSync();

    expect(result.skipped).toBe(false);
    expect(result.providers.opencode.error).toBeUndefined();

    // Persisted sets respect each provider's free filter.
    expect(state.freeModels.opencode.ids.sort()).toEqual(["deepseek-v4-flash-free", "x-preview-f-free"]);
    expect(state.freeModels.openrouter.ids).toEqual(["google/gemma-x:free"]);
    expect(state.freeModels["mimo-free"].ids).toEqual(["mimo-v2.5"]);

    // Custom-model diff: added the newcomer, removed the vanished one.
    expect(state.customModels.get("oc|x-preview-f-free|llm")).toBeTruthy();
    expect(state.customModels.has("oc|vanished-old|llm")).toBe(false);

    // Auto-combo rewritten with the full ordered member list (no stale members).
    const combo = state.combos.get("combo-1");
    expect(combo.models).toContain("oc/x-preview-f-free");
    expect(combo.models).toContain("openrouter/google/gemma-x:free");
    expect(combo.models.includes("oc/vanished-old")).toBe(false);
  });

  it("sends registry transport headers to the opencode endpoint", async () => {
    state.freeModels.opencode = { ids: [], updatedAt: "2026-01-01T00:00:00Z" };
    const { runFreeModelSync } = await import("../../src/shared/services/freeModelSync.js");
    await runFreeModelSync();
    const zenCall = fetchMock.mock.calls.find(([u]) => String(u).includes("opencode.ai/zen"));
    expect(zenCall).toBeTruthy();
    expect(zenCall[1]?.headers?.["x-opencode-client"]).toBe("desktop");
  });

  it("never deletes customs on first run (no previous snapshot)", async () => {
    state.customModels.set("oc|user-manual|llm", { providerAlias: "oc", id: "user-manual", type: "llm" });
    const { runFreeModelSync } = await import("../../src/shared/services/freeModelSync.js");
    await runFreeModelSync();
    expect(state.customModels.has("oc|user-manual|llm")).toBe(true);
  });

  it("isolates per-provider failures — one dead endpoint keeps the others", async () => {
    fetchMock.mockImplementation((url) => {
      if (String(url).includes("openrouter.ai")) return jsonResponse({ error: "boom" }, { ok: false, status: 500 });
      const hit = Object.keys(CATALOGS).find((frag) => String(url).includes(frag));
      return hit ? CATALOGS[hit]() : jsonResponse({ data: [] });
    });
    const { runFreeModelSync } = await import("../../src/shared/services/freeModelSync.js");
    const result = await runFreeModelSync();
    expect(result.providers.openrouter.error).toMatch(/500/);
    expect(result.providers.opencode.count).toBeGreaterThan(0);
    expect(state.freeModels.opencode.ids.length).toBeGreaterThan(0);
  });

  it("skips when a run is already in flight", async () => {
    const mod = await import("../../src/shared/services/freeModelSync.js");
    const pending = [];
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.push(resolve);
        })
    );
    const first = mod.runFreeModelSync();
    const second = await mod.runFreeModelSync();
    let settled = false;
    first.catch(() => {}).then(() => { settled = true; });
    // The sync walks targets sequentially, so fetches pend one at a time.
    // Keep draining until the whole run has no in-flight upstream left.
    for (let i = 0; i < 20 && !settled; i++) {
      const batch = pending.splice(0, pending.length);
      for (const resolve of batch) resolve(jsonResponse({ data: [] }));
      await new Promise((r) => setImmediate(r));
    }
    await first;
    expect(second.skipped).toBe(true);
  });
});

describe("buildModelsList free-catalog merge", () => {
  it("lists synced free-provider models without any stored connection", async () => {
    state.freeModels.opencode = { ids: ["x-preview-f-free"], updatedAt: "now" };
    state.freeModels.openrouter = { ids: ["google/gemma-x:free"], updatedAt: "now" };

    const { buildModelsList } = await import("../../src/app/api/v1/models/route.js");
    const models = await buildModelsList(["llm"]);

    expect(models.map((m) => m.id)).toContain("oc/x-preview-f-free");
    const ocEntry = models.find((m) => m.id === "oc/x-preview-f-free");
    expect(ocEntry.owned_by).toBe("oc");
    // openrouter has static/config models too; merged free ids must not duplicate
    const orFree = models.filter((m) => m.id === "openrouter/google/gemma-x:free");
    expect(orFree.length).toBe(1);
  });

  it("hides disabled free models and non-LLM kinds under llm kindFilter", async () => {
    state.freeModels.opencode = { ids: ["x-preview-f-free", "deepseek-v4-flash-free"], updatedAt: "now" };
    state.disabledByAlias = { oc: ["deepseek-v4-flash-free"] };

    const { buildModelsList } = await import("../../src/app/api/v1/models/route.js");
    const models = await buildModelsList(["llm"]);
    const ids = models.map((m) => m.id);

    expect(ids).toContain("oc/x-preview-f-free");
    expect(ids).not.toContain("oc/deepseek-v4-flash-free");
  });
});
