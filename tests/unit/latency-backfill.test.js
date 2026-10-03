// Backfill latency from requestDetails into usageHistory (v3 migration)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-backfill-"));
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

describe("Latency backfill v3", () => {
  it("migrates usageHistory ttft/totalLatency from requestDetails via timestamp+provider+model match", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { latestVersion } = await import("@/lib/db/migrations/index.js");
    const db = await getAdapter();
    const ts = new Date("2026-08-04T10:00:00Z").toISOString();

    db.run(
      `INSERT INTO usageHistory(timestamp, provider, model, promptTokens, completionTokens, cost, status, tokens, meta, ttft, totalLatency) VALUES(?,?,?,?,?,?,?,?,?,0,0)`,
      [ts, "openai", "gpt-4", 100, 50, 0.01, "ok", '{}', '{}']
    );
    const uhId = db.get(`SELECT id FROM usageHistory WHERE timestamp = ?`, [ts]).id;

    // requestDetails uses a different ID format — match is by timestamp+provider+model
    db.run(
      `INSERT INTO requestDetails(id, timestamp, provider, model, status, data) VALUES(?,?,?,?,?,?)`,
      [`rd-different-format-${ts}`, ts, "openai", "gpt-4", "success", JSON.stringify({ latency: { ttft: 200, total: 500 } })]
    );

    // Simulate existing DB at v2
    db.run(`UPDATE _meta SET value = '2' WHERE key = 'schemaVersion'`);
    db.close?.();

    // Reboot: v3 backfill should run
    delete global._dbAdapter;
    vi.resetModules();
    const { getAdapter: g2 } = await import("@/lib/db/driver.js");
    const db2 = await g2();

    expect(latestVersion()).toBe(3);

    const row = db2.get(`SELECT ttft, totalLatency FROM usageHistory WHERE id = ?`, [uhId]);
    expect(row.ttft).toBe(200);
    expect(row.totalLatency).toBe(500);
  });

  it("skips usageHistory rows with no matching requestDetails entry", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const ts = new Date("2026-08-04T12:00:00Z").toISOString();

    db.run(
      `INSERT INTO usageHistory(timestamp, provider, model, promptTokens, completionTokens, cost, status, tokens, meta, ttft, totalLatency) VALUES(?,?,?,?,?,?,?,?,?,0,0)`,
      [ts, "anthropic", "claude-3", 80, 40, 0.005, "ok", '{}', '{}']
    );
    db.run(`UPDATE _meta SET value = '2' WHERE key = 'schemaVersion'`);
    db.close?.();

    delete global._dbAdapter;
    vi.resetModules();
    const { getAdapter: g2 } = await import("@/lib/db/driver.js");
    const db2 = await g2();

    const row = db2.get(`SELECT ttft, totalLatency FROM usageHistory WHERE timestamp = ?`, [ts]);
    expect(row.ttft).toBe(0);
    expect(row.totalLatency).toBe(0);
  });

  it("handles malformed requestDetails data gracefully", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const ts = new Date("2026-08-04T13:00:00Z").toISOString();

    db.run(
      `INSERT INTO usageHistory(timestamp, provider, model, promptTokens, completionTokens, cost, status, tokens, meta, ttft, totalLatency) VALUES(?,?,?,?,?,?,?,?,?,0,0)`,
      [ts, "openai", "gpt-4", 50, 25, 0.003, "ok", '{}', '{}']
    );
    db.run(
      `INSERT INTO requestDetails(id, timestamp, provider, model, status, data) VALUES(?,?,?,?,?,?)`,
      [`rd-bad`, ts, "openai", "gpt-4", "ok", 'not-valid-json']
    );
    db.run(`UPDATE _meta SET value = '2' WHERE key = 'schemaVersion'`);
    db.close?.();

    delete global._dbAdapter;
    vi.resetModules();
    const { getAdapter: g2 } = await import("@/lib/db/driver.js");
    const db2 = await g2();

    const row = db2.get(`SELECT ttft, totalLatency FROM usageHistory WHERE timestamp = ?`, [ts]);
    expect(row.ttft).toBe(0);
    expect(row.totalLatency).toBe(0);
  });
});
