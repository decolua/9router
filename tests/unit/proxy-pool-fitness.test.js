import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-fitness-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  delete global.__9routerPoolFitness__;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("proxy-pool fitness persistence", () => {
  it("persists fitness at schema version three and excludes exact and wildcard scopes", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { createProxyPool } = await import("@/lib/db/repos/proxyPoolsRepo.js");
    const { markPoolUnfit, fitPoolIds } = await import("../../open-sse/services/proxyPoolFitness.js");
    const db = await getAdapter();
    expect(db.get("SELECT value FROM _meta WHERE key = 'schemaVersion'").value).toBe("3");
    await createProxyPool({ id: "pool-a", name: "A", proxyUrl: "http://proxy-a" });

    await markPoolUnfit("pool-a", "freebuff::model-a", Date.now() + 60_000);
    expect(fitPoolIds(["pool-a"], "freebuff::model-a")).toEqual([]);
    expect(fitPoolIds(["pool-a"], "freebuff::model-b")).toEqual(["pool-a"]);

    await markPoolUnfit("pool-a", "freebuff::*", Date.now() + 60_000);
    expect(fitPoolIds(["pool-a"], "freebuff::model-b")).toEqual([]);
  });

  it("drops expired fitness instead of treating it as unfit", async () => {
    const { createProxyPool } = await import("@/lib/db/repos/proxyPoolsRepo.js");
    const { listProxyPoolFitness } = await import("@/lib/db/repos/proxyPoolFitnessRepo.js");
    const { loadPoolFitness, markPoolUnfit, fitPoolIds } = await import("../../open-sse/services/proxyPoolFitness.js");
    await createProxyPool({ id: "pool-expired", name: "Expired", proxyUrl: "http://proxy" });
    await markPoolUnfit("pool-expired", "freebuff::model", Date.now() - 1);
    await loadPoolFitness("pool-expired");

    expect(fitPoolIds(["pool-expired"], "freebuff::model")).toEqual(["pool-expired"]);
    expect(await listProxyPoolFitness("pool-expired")).toEqual([]);
  });

  it("removes persisted fitness when its pool is deleted", async () => {
    const { createProxyPool, deleteProxyPool } = await import("@/lib/db/repos/proxyPoolsRepo.js");
    const { listProxyPoolFitness } = await import("@/lib/db/repos/proxyPoolFitnessRepo.js");
    const { markPoolUnfit } = await import("../../open-sse/services/proxyPoolFitness.js");
    await createProxyPool({ id: "pool-deleted", name: "Deleted", proxyUrl: "http://proxy" });
    await markPoolUnfit("pool-deleted", "freebuff::model", Date.now() + 60_000);
    await deleteProxyPool("pool-deleted");

    expect(await listProxyPoolFitness("pool-deleted")).toEqual([]);
  });
});
