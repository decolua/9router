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
});
