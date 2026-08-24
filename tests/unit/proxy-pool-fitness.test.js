import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;
beforeEach(() => { tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-fitness-")); process.env.DATA_DIR = tempDir; delete global._dbAdapter; delete global.__9routerPoolFitness__; vi.resetModules(); });
afterEach(() => { try { global._dbAdapter?.instance?.close?.(); } catch {} delete global._dbAdapter; fs.rmSync(tempDir, { recursive: true, force: true }); if (originalDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = originalDataDir; });

describe("proxy-pool fitness persistence", () => {
  it("migrates version four and applies exact plus wildcard scopes", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { markPoolUnfit, fitPoolIds } = await import("../../open-sse/services/proxyPoolFitness.js");
    const db = await getAdapter();
    expect(db.get("SELECT value FROM _meta WHERE key = 'schemaVersion'").value).toBe("4");
    await markPoolUnfit("pool-a", "freebuff::model-a", Date.now() + 60_000, "failure");
    expect(fitPoolIds(["pool-a"], "freebuff::model-a")).toEqual([]);
    expect(fitPoolIds(["pool-a"], "freebuff::model-b")).toEqual(["pool-a"]);
    await markPoolUnfit("pool-a", "freebuff::*", Date.now() + 60_000, "failure");
    expect(fitPoolIds(["pool-a"], "freebuff::model-b")).toEqual([]);
  });
  it("keeps longer expiry and versions equal expiry", async () => {
    const { upsertProxyPoolFitness } = await import("@/lib/db/repos/proxyPoolFitnessRepo.js");
    const until = Date.now() + 60_000;
    await upsertProxyPoolFitness("pool-monotonic", "freebuff::model", until, "first");
    const shorter = await upsertProxyPoolFitness("pool-monotonic", "freebuff::model", until - 1, "shorter");
    const equal = await upsertProxyPoolFitness("pool-monotonic", "freebuff::model", until, "equal");
    expect(shorter).toMatchObject({ until, reason: "first", version: 1 });
    expect(equal).toMatchObject({ until, reason: "equal", version: 2 });
  });
  it("persists monotonic fitness across adapter reopen", async () => {
    const { markPoolUnfit } = await import("../../open-sse/services/proxyPoolFitness.js");
    const until = Date.now() + 60_000;
    await markPoolUnfit("pool-restart", "freebuff::model", until, "longer");
    await markPoolUnfit("pool-restart", "freebuff::model", until - 1, "shorter");
    global._dbAdapter.instance.close(); delete global._dbAdapter; delete global.__9routerPoolFitness__; vi.resetModules();
    const { listProxyPoolFitness } = await import("@/lib/db/repos/proxyPoolFitnessRepo.js");
    const [persisted] = await listProxyPoolFitness("pool-restart");
    expect(persisted).toMatchObject({ until, reason: "longer", version: 1 });
  });
  it("returns active versioned entries in snapshots", async () => {
    const { markPoolUnfit, poolFitnessSnapshot } = await import("../../open-sse/services/proxyPoolFitness.js");
    const until = Date.now() + 60_000;
    await markPoolUnfit("pool-snapshot", "freebuff::model", until, "reason");
    expect(await poolFitnessSnapshot()).toMatchObject({ "pool-snapshot": { "freebuff::model": { until, reason: "reason", version: 1 } } });
  });
  it("clears only a matching observed version", async () => {
    const { markPoolUnfit, clearPoolUnfit, fitPoolIds } = await import("../../open-sse/services/proxyPoolFitness.js");
    const marked = await markPoolUnfit("pool-clear", "freebuff::model", Date.now() + 60_000, "mark");
    expect(await clearPoolUnfit("pool-clear", "freebuff::model", marked.version + 1)).toBe(false);
    expect(fitPoolIds(["pool-clear"], "freebuff::model")).toEqual([]);
    expect(await clearPoolUnfit("pool-clear", "freebuff::model", marked.version)).toBe(true);
    expect(fitPoolIds(["pool-clear"], "freebuff::model")).toEqual(["pool-clear"]);
  });
  it("preserves newer exact failures and isolates pool, model, and wildcard rows", async () => {
    const { markPoolUnfit, clearPoolUnfit, fitPoolIds } = await import("../../open-sse/services/proxyPoolFitness.js");
    const until = Date.now() + 60_000;
    const observed = await markPoolUnfit("pool-a", "freebuff::model-a", until, "first");
    const newer = await markPoolUnfit("pool-a", "freebuff::model-a", until, "newer");
    await markPoolUnfit("pool-a", "freebuff::model-b", until, "model-b");
    await markPoolUnfit("pool-b", "freebuff::model-a", until, "pool-b");
    await markPoolUnfit("pool-a", "freebuff::*", until, "wildcard");
    expect(await clearPoolUnfit("pool-a", "freebuff::model-a", observed.version)).toBe(false);
    expect(await clearPoolUnfit("pool-a", "freebuff::model-a", 0)).toBe(false);
    expect(await clearPoolUnfit("pool-a", "freebuff::model-a", newer.version)).toBe(true);
    expect(fitPoolIds(["pool-a"], "freebuff::model-a")).toEqual([]);
    expect(fitPoolIds(["pool-b"], "freebuff::model-a")).toEqual([]);
  });
  it("rejects invalid mark inputs without persistence", async () => {
    const { markPoolUnfit } = await import("../../open-sse/services/proxyPoolFitness.js");
    expect(await markPoolUnfit("", "freebuff::model", Date.now())).toBeNull();
    expect(await markPoolUnfit("pool", "", Date.now())).toBeNull();
    expect(await markPoolUnfit("pool", "freebuff::model", Number.NaN)).toBeNull();
  });
  it("prunes expired once while preserving active sibling", async () => {
    const { upsertProxyPoolFitness, listProxyPoolFitness } = await import("@/lib/db/repos/proxyPoolFitnessRepo.js");
    const { pruneExpired } = await import("../../open-sse/services/proxyPoolFitness.js");
    const now = Date.now();
    await upsertProxyPoolFitness("pool-prune", "freebuff::active", now + 60_000, "active");
    await upsertProxyPoolFitness("pool-prune", "freebuff::expired", now - 1, "expired");
    expect(await pruneExpired(now)).toBe(1);
    expect(await pruneExpired(now)).toBe(0);
    expect(await listProxyPoolFitness("pool-prune")).toMatchObject([{ scope: "freebuff::active" }]);
  });
  it("shares readiness, retries rejection, and reopens through driver close", async () => {
    const { getAdapter, getProxyFitnessReady, closeAdapter } = await import("@/lib/db/driver.js");
    const { createProxyPool } = await import("@/lib/db/repos/proxyPoolsRepo.js");
    const { upsertProxyPoolFitness } = await import("@/lib/db/repos/proxyPoolFitnessRepo.js");
    const db = await getAdapter();
    await createProxyPool({ id: "pool-ready", name: "Ready", proxyUrl: "http://proxy" });
    await upsertProxyPoolFitness("pool-ready", "freebuff::model", Date.now() + 60_000, "active");
    const first = getProxyFitnessReady();
    expect(getProxyFitnessReady()).toBe(first);
    await expect(first).resolves.toBe(true);
    closeAdapter();
    expect(await getAdapter()).not.toBe(db);
    delete global.__9routerPoolFitness__;
    vi.resetModules();
    const reloaded = await import("@/lib/db/driver.js");
    const pending = reloaded.getProxyFitnessReady();
    expect(reloaded.getProxyFitnessReady()).toBe(pending);
    await expect(pending).resolves.toBe(true);
    const { resolveConnectionProxyConfig } = await import("@/lib/network/connectionProxy.js");
    await expect(resolveConnectionProxyConfig({ proxyPoolIds: ["pool-ready"], proxyRotationStrategy: "smart", proxyPoolScope: "freebuff::model" })).resolves.toMatchObject({ noFitPool: true });
  });
  it("shares a rejected hydration then retries while caching false", async () => {
    let calls = 0;
    let reject = true;
    vi.doMock("../../open-sse/services/proxyPoolFitness.js", () => ({ hydratePoolFitness: vi.fn(() => {
      calls += 1;
      return reject ? Promise.reject(new Error("hydrate failed")) : Promise.resolve(false);
    }) }));
    delete global._dbAdapter;
    vi.resetModules();
    const driver = await import("@/lib/db/driver.js");
    const first = driver.getProxyFitnessReady();
    expect(driver.getProxyFitnessReady()).toBe(first);
    await expect(first).rejects.toThrow("hydrate failed");
    expect(calls).toBe(1);
    reject = false;
    const retry = driver.getProxyFitnessReady();
    expect(retry).not.toBe(first);
    await expect(retry).resolves.toBe(false);
    expect(driver.getProxyFitnessReady()).toBe(retry);
    expect(calls).toBe(2);
    vi.doUnmock("../../open-sse/services/proxyPoolFitness.js");
    vi.resetModules();
  });
  it("retains live state when close throws", async () => {
    const adapter = { close: vi.fn(() => { throw new Error("close failed"); }) };
    const initPromise = Promise.resolve(adapter);
    const readyPromise = Promise.resolve(true);
    global._dbAdapter = { instance: adapter, initPromise, fitnessReadyPromise: readyPromise, generation: 0, logged: false };
    vi.resetModules();
    const { closeAdapter } = await import("@/lib/db/driver.js");
    expect(() => closeAdapter()).toThrow("close failed");
    expect(global._dbAdapter).toMatchObject({ instance: adapter, initPromise, fitnessReadyPromise: readyPromise, generation: 0 });
    adapter.close.mockImplementation(() => {});
    closeAdapter();
    expect(global._dbAdapter).toMatchObject({ instance: null, initPromise: null, fitnessReadyPromise: null, generation: 1 });
  });
  it("cancels in-flight initialization before a stale adapter can publish", async () => {
    const deferred = {};
    deferred.promise = new Promise((resolve) => { deferred.resolve = resolve; });
    const stale = { close: vi.fn() };
    vi.doMock("@/lib/db/adapters/betterSqliteAdapter.js", () => ({ createBetterSqliteAdapter: vi.fn(() => deferred.promise) }));
    vi.doMock("@/lib/db/migrate.js", () => ({ runMigrationOnce: vi.fn() }));
    delete global._dbAdapter;
    vi.resetModules();
    const driver = await import("@/lib/db/driver.js");
    const first = driver.getAdapter();
    driver.closeAdapter();
    deferred.resolve(stale);
    await expect(first).rejects.toThrow("cancelled");
    expect(stale.close).toHaveBeenCalledTimes(1);
    expect(global._dbAdapter.instance).toBeNull();
    vi.doUnmock("@/lib/db/adapters/betterSqliteAdapter.js");
    vi.doUnmock("@/lib/db/migrate.js");
    vi.resetModules();
    const freshDriver = await import("@/lib/db/driver.js");
    await expect(freshDriver.getAdapter()).resolves.toBeDefined();
  });
  it("rolls back rows and retains cache after a post-fitness delete failure", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { createProxyPool, getProxyPoolById } = await import("@/lib/db/repos/proxyPoolsRepo.js");
    const { listProxyPoolFitness } = await import("@/lib/db/repos/proxyPoolFitnessRepo.js");
    const { deleteProxyPool } = await import("@/lib/localDb.js");
    const { markPoolUnfit, fitPoolIds } = await import("../../open-sse/services/proxyPoolFitness.js");
    await createProxyPool({ id: "pool-rollback", name: "Rollback", proxyUrl: "http://proxy" });
    await markPoolUnfit("pool-rollback", "freebuff::model", Date.now() + 60_000);
    const db = await getAdapter(); const run = db.run.bind(db);
    vi.spyOn(db, "run").mockImplementation((sql, params) => {
      if (sql === "DELETE FROM proxyPools WHERE id = ?") throw new Error("forced pool failure");
      return run(sql, params);
    });
    await expect(deleteProxyPool("pool-rollback")).rejects.toThrow("forced pool failure");
    expect(await getProxyPoolById("pool-rollback")).toMatchObject({ id: "pool-rollback" });
    expect(await listProxyPoolFitness("pool-rollback")).toHaveLength(1);
    expect(fitPoolIds(["pool-rollback"], "freebuff::model")).toEqual([]);
    db.run.mockRestore();
  });
  it("deletes via localDb export transaction then evicts only after commit", async () => {
    const { createProxyPool, getProxyPoolById } = await import("@/lib/db/repos/proxyPoolsRepo.js");
    const { deleteProxyPool } = await import("@/lib/localDb.js");
    const { markPoolUnfit, fitPoolIds } = await import("../../open-sse/services/proxyPoolFitness.js");
    await createProxyPool({ id: "pool-delete", name: "Delete", proxyUrl: "http://proxy" });
    await markPoolUnfit("pool-delete", "freebuff::model", Date.now() + 60_000);
    await expect(deleteProxyPool("pool-delete")).resolves.toMatchObject({ id: "pool-delete" });
    expect(await getProxyPoolById("pool-delete")).toBeNull();
    expect(fitPoolIds(["pool-delete"], "freebuff::model")).toEqual(["pool-delete"]);
    await expect(deleteProxyPool("pool-delete")).resolves.toBeNull();
  });
});
