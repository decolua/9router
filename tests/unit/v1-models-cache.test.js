import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
  getDisabledModels: vi.fn(),
}));

vi.mock("../../src/lib/localDb.js", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getCombos: mocks.getCombos,
  getCustomModels: mocks.getCustomModels,
  getModelAliases: mocks.getModelAliases,
}));

vi.mock("../../src/lib/disabledModelsDb.js", () => ({
  getDisabledModels: mocks.getDisabledModels,
}));

const { getCachedModelsList } = await import("../../src/app/api/v1/models/route.js");

// Freeze Date.now at a controllable value instead of using fake timers, so the
// cache TTL can be expired precisely while background rebuilds settle on real
// timers/microtasks.
let currentTime = Date.now();
let dateNowSpy;
// Unique kind per test: the cache is keyed on the kind filter, so this keeps
// tests isolated from each other's cache entries.
let kind;

function primeDb() {
  mocks.getProviderConnections.mockResolvedValue([]);
  mocks.getCombos.mockResolvedValue([{ name: "combo-a", kind }]);
  mocks.getCustomModels.mockResolvedValue([]);
  mocks.getModelAliases.mockResolvedValue({});
  mocks.getDisabledModels.mockResolvedValue({});
}

beforeEach(() => {
  vi.clearAllMocks();
  currentTime = Date.now();
  dateNowSpy = vi.spyOn(Date, "now").mockImplementation(() => currentTime);
  kind = `testkind-${Math.random().toString(36).slice(2)}`;
  primeDb();
});

afterEach(() => {
  dateNowSpy.mockRestore();
  vi.restoreAllMocks();
});

describe("getCachedModelsList", () => {
  it("reuses the cached list within the TTL without rebuilding", async () => {
    const first = await getCachedModelsList([kind]);
    const second = await getCachedModelsList([kind]);

    expect(second).toBe(first);
    expect(mocks.getCombos).toHaveBeenCalledTimes(1);
  });

  it("serves the stale list immediately and rebuilds in the background after the TTL", async () => {
    const stale = await getCachedModelsList([kind]);

    // Expire the cache entry and change the underlying data.
    currentTime += 31_000;
    mocks.getCombos.mockResolvedValue([{ name: "combo-b", kind }]);

    const served = await getCachedModelsList([kind]);
    expect(served).toBe(stale); // stale-but-usable list returned right away

    // The background refresh settles and later callers see the fresh list.
    let refreshed;
    await vi.waitFor(async () => {
      refreshed = await getCachedModelsList([kind]);
      expect(refreshed.map((m) => m.id)).toContain("combo-b");
    });
    expect(refreshed).not.toBe(stale);
  });

  it("keys the cache on skipDynamicFetch so internal fetches get their own list", async () => {
    await getCachedModelsList([kind]);
    await getCachedModelsList([kind], { skipDynamicFetch: true });

    expect(mocks.getCombos).toHaveBeenCalledTimes(2);
  });

  it("keeps serving the previous list when a rebuild comes back degraded", async () => {
    const cached = await getCachedModelsList([kind]);

    currentTime += 31_000;
    // buildModelsList swallows per-source DB errors and resolves with a
    // degraded (empty) list — the cache must not blank out the model picker.
    mocks.getCombos.mockResolvedValue([]);
    mocks.getProviderConnections.mockRejectedValue(new Error("db gone"));

    let served;
    await vi.waitFor(async () => {
      served = await getCachedModelsList([kind]);
      expect(served).toBe(cached);
    });
    expect(served).toBe(cached);
  });

  it("forceFresh bypasses the cache and repopulates it", async () => {
    await getCachedModelsList([kind]);

    currentTime += 31_000;
    mocks.getCombos.mockResolvedValue([{ name: "combo-c", kind }]);

    const fresh = await getCachedModelsList([kind], { forceFresh: true });
    expect(fresh.map((m) => m.id)).toContain("combo-c");

    // The force-fresh result is now cached: next call is a hit.
    const builds = mocks.getCombos.mock.calls.length;
    const next = await getCachedModelsList([kind]);
    expect(next).toBe(fresh);
    expect(mocks.getCombos.mock.calls.length).toBe(builds);
  });
});
