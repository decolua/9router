import { afterEach, beforeEach, expect, it, vi } from "vitest";
const store = vi.hoisted(() => ({}));
vi.mock("../../src/lib/db/helpers/kvStore.js", () => ({
  makeKv: () => ({ get: async key => store[key], setMany: async values => Object.assign(store, values) }),
}));
import { getCatalog, CATALOG_TTL_MS, __resetCacheForTests } from "../../src/lib/modelsDev/index.js";
beforeEach(() => {
  __resetCacheForTests();
  for (const key of Object.keys(store)) delete store[key];
});
afterEach(() => vi.unstubAllGlobals());
it("reuses the fresh persisted catalog across memory-cache resets", async () => {
  const fetcher = vi.fn(async () => Response.json({ openai: { models: {} } }));
  vi.stubGlobal("fetch", fetcher);
  await getCatalog();
  __resetCacheForTests();
  expect((await getCatalog()).stale).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
});
it("serves stale data after a bounded network refresh fails", async () => {
  store.catalog = { openai: { models: {} } };
  store.fetchedAt = Date.now() - CATALOG_TTL_MS - 1000;
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
  expect(await getCatalog()).toMatchObject({ catalog: store.catalog, stale: true });
});
it("does not cache malformed remote data or manufacture a catalog without a fallback", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json([])));
  await expect(getCatalog()).rejects.toThrow("Invalid models.dev catalog");
  expect(store.catalog).toBeUndefined();
});
