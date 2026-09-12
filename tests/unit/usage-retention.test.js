// Retention — rows past the stats horizon are pruned (raw + daily at 61 local
// days, hourly at 3), reads inside the window keep everything, and the run is
// time-gated via _meta so a crashed run retries on next boot.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-retention-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

async function adapter() {
  const { getAdapter } = await import("@/lib/db/driver.js");
  return getAdapter();
}

function daysAgo(n) {
  return new Date(Date.now() - n * 86400000).toISOString();
}

describe("usage retention", () => {
  it("prunes past-horizon rows and keeps in-window rows in every table", async () => {
    const a = await adapter();

    // Raw + rollups via the real write path (old + recent)
    await db.saveRequestUsage({ provider: "keep", model: "m", tokens: { prompt_tokens: 1, completion_tokens: 1 } });
    await db.saveRequestUsage({
      provider: "prune", model: "m", tokens: { prompt_tokens: 1, completion_tokens: 1 },
      timestamp: daysAgo(70),
    });
    // requestDetails + legacy usageDaily blobs past horizon
    a.run(`INSERT INTO requestDetails(id, timestamp, data) VALUES('old-detail', ?, '{}')`, [daysAgo(70)]);
    a.run(`INSERT INTO requestDetails(id, timestamp, data) VALUES('new-detail', ?, '{}')`, [daysAgo(10)]);
    a.run(`INSERT INTO usageDaily(dateKey, data) VALUES('2020-01-01', '{}')`);
    // hourly rollup row just outside the 3-day hourly horizon (via direct insert)
    const oldHourlyKey = (() => {
      const d = new Date(Date.now() - 5 * 86400000);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    })();
    a.run(`INSERT INTO usageRollupHourly(dateKey, hour, dimension, dimKey, model) VALUES(?, 0, 'provider', 'prune', 'm')`, [oldHourlyKey]);

    const { runRetention } = await import("@/lib/db/repos/usageRetention.js");
    const counts = await runRetention();

    expect(counts.usageHistory).toBeGreaterThanOrEqual(1);      // the 70d-old row
    expect(counts.requestDetails).toBe(1);
    expect(counts.usageDaily).toBe(1);
    // 4 dims from saveRequestUsage's 70d-old write + the direct insert
    expect(counts.usageRollupHourly).toBeGreaterThanOrEqual(5);
    expect(counts.usageRollupDaily).toBeGreaterThanOrEqual(1);  // 70d-old daily rollup

    expect(a.get(`SELECT COUNT(*) c FROM usageHistory WHERE provider = 'keep'`).c).toBe(1);
    expect(a.get(`SELECT COUNT(*) c FROM usageHistory WHERE provider = 'prune'`).c).toBe(0);
    expect(a.get(`SELECT COUNT(*) c FROM requestDetails`).c).toBe(1); // only new-detail
    expect(a.get(`SELECT COUNT(*) c FROM usageDaily`).c).toBe(0);
    expect(a.get(`SELECT COUNT(*) c FROM usageRollupDaily WHERE dimKey = 'keep'`).c).toBe(1);
  });

  it("gates runs via _meta so they fire at most once per interval", async () => {
    const a = await adapter();
    const { getMetaSync, setMetaSync } = await import("@/lib/db/helpers/metaStore.js");
    const { runRetentionGated } = await import("@/lib/db/repos/usageRetention.js");

    // Force the gate open (the boot-time run already stamped it)
    setMetaSync(a, "lastRetentionAt", "0");

    // nothing new past the horizon since the previous test pruned it all
    const counts = await runRetentionGated();
    expect(Object.values(counts).reduce((s, n) => s + n, 0)).toBe(0);
    expect(parseInt(getMetaSync(a, "lastRetentionAt", "0"), 10)).toBeGreaterThan(0);

    const second = await runRetentionGated();
    expect(second).toBeNull(); // gated by the just-written timestamp
  });

  it("enables incremental auto_vacuum (migration 003)", async () => {
    const a = await adapter();
    const mode = a.get(`PRAGMA auto_vacuum`).auto_vacuum;
    expect(mode).toBe(2); // 2 = incremental
  });
});
