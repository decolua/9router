// Test for latency columns migration (v2)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-latency-mig-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("Latency migration v2", () => {
  it("fresh DB → applies v2 migration with ttft and totalLatency columns", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { latestVersion } = await import("@/lib/db/migrations/index.js");
    const db = await getAdapter();

    // Schema version should be 3 (v2 adds columns, v3 backfills from requestDetails)
    const row = db.get(`SELECT value FROM _meta WHERE key='schemaVersion'`);
    expect(parseInt(row.value, 10)).toBe(3);
    expect(latestVersion()).toBe(3);

    // usageHistory should have new latency columns
    const cols = db.all(`PRAGMA table_info(usageHistory)`);
    const colNames = cols.map(c => c.name);
    expect(colNames).toContain("ttft");
    expect(colNames).toContain("totalLatency");

    // New columns should have DEFAULT 0
    const ttftCol = cols.find(c => c.name === "ttft");
    const totalLatencyCol = cols.find(c => c.name === "totalLatency");
    expect(ttftCol.dflt_value).toBe("0");
    expect(totalLatencyCol.dflt_value).toBe("0");
  });

  it("existing DB at v1 → upgrades to v2 with latency columns", async () => {
    // 1st boot at v1
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();

    // Insert some usage data at v1
    db.run(
      `INSERT INTO usageHistory(timestamp, provider, model, promptTokens, completionTokens, cost, status, tokens, meta)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [new Date().toISOString(), "openai", "gpt-4", 100, 50, 0.01, "ok", '{}', '{}']
    );

    // Manually set schema version to 1
    db.run(`UPDATE _meta SET value = '1' WHERE key = 'schemaVersion'`);
    db.close?.();

    // 2nd boot: migration should run
    delete global._dbAdapter;
    vi.resetModules();
    const { getAdapter: getAdapter2 } = await import("@/lib/db/driver.js");
    const db2 = await getAdapter2();

    // Schema version should be 3
    const row = db2.get(`SELECT value FROM _meta WHERE key='schemaVersion'`);
    expect(parseInt(row.value, 10)).toBe(3);

    // New columns should exist
    const cols = db2.all(`PRAGMA table_info(usageHistory)`);
    const colNames = cols.map(c => c.name);
    expect(colNames).toContain("ttft");
    expect(colNames).toContain("totalLatency");

    // Existing data should have 0 for new columns
    const usage = db2.get(`SELECT * FROM usageHistory`);
    expect(usage.ttft).toBe(0);
    expect(usage.totalLatency).toBe(0);
  });
});