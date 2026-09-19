// F8 M-3 (D8): usage retention via USAGE_RETENTION_DAYS, DEFAULT OFF.
// With the env unset/0/invalid NOTHING may be deleted. With N>0, raw
// usageHistory rows older than N days are pruned on a safe cycle (after a
// successful write), while usageDaily aggregates are always kept.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalRetention = process.env.USAGE_RETENTION_DAYS;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-f8-ret-"));
  process.env.DATA_DIR = tempDir;
  delete process.env.USAGE_RETENTION_DAYS;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(async () => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalRetention === undefined) delete process.env.USAGE_RETENTION_DAYS;
  else process.env.USAGE_RETENTION_DAYS = originalRetention;
});

async function loadRepo() {
  const repo = await import("@/lib/db/repos/usageRepo.js");
  const { getAdapter } = await import("@/lib/db/driver.js");
  return { repo, getAdapter };
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString();
}

async function seedHistory(db, timestamp, usageEventId) {
  await db.run(
    `INSERT INTO usageHistory(usageEventId, timestamp, provider, model, promptTokens, completionTokens, cost, status, tokens, meta) VALUES(?, ?, 'p', 'm', 1, 1, 0, 'ok', '{}', '{}')`,
    [usageEventId, timestamp]
  );
}

function dateKeyOf(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function seedDaily(db, dateKey) {
  db.run(
    `INSERT INTO usageDaily(dateKey, data) VALUES(?, ?) ON CONFLICT(dateKey) DO UPDATE SET data = excluded.data`,
    [dateKey, JSON.stringify({ requests: 1 })]
  );
}

describe("USAGE_RETENTION_DAYS (default OFF, D8)", () => {
  it("is OFF by default: unset env deletes nothing even for year-old rows", async () => {
    const { repo, getAdapter } = await loadRepo();
    const db = await getAdapter();
    await seedHistory(db, isoDaysAgo(400), "old-1");
    await seedDaily(db, dateKeyOf(isoDaysAgo(400)));

    const res = await repo.applyUsageRetention();
    expect(res).toMatchObject({ enabled: false, days: 0, deleted: 0 });
    expect(db.all(`SELECT id FROM usageHistory`).length).toBe(1);
    expect(db.all(`SELECT dateKey FROM usageDaily`).length).toBe(1);
  });

  it("invalid/zero/negative env values stay OFF", async () => {
    for (const raw of ["0", "-5", "abc", "", "   ", "NaN"]) {
      process.env.USAGE_RETENTION_DAYS = raw;
      const { repo, getAdapter } = await loadRepo();
      const db = await getAdapter();
      await seedHistory(db, isoDaysAgo(400), `old-${raw}`);
      const res = await repo.applyUsageRetention({ force: true });
      expect(res.enabled, `env=${JSON.stringify(raw)}`).toBe(false);
      // the row seeded in THIS iteration must survive (same db file across
      // iterations is fine — we only assert about our own marker row)
      expect(db.all(`SELECT id FROM usageHistory WHERE usageEventId = ?`, [`old-${raw}`]).length, `env=${JSON.stringify(raw)}`).toBe(1);
      try { global._dbAdapter?.instance?.close?.(); } catch {}
      delete global._dbAdapter;
      vi.resetModules();
    }
  });

  it("with N>0 prunes old raw usageHistory, keeps recent rows and ALL usageDaily aggregates", async () => {
    process.env.USAGE_RETENTION_DAYS = "30";
    const { repo, getAdapter } = await loadRepo();
    const db = await getAdapter();
    const oldTs = isoDaysAgo(100);
    await seedHistory(db, oldTs, "old-1");
    await seedHistory(db, isoDaysAgo(1), "new-1");
    await seedDaily(db, dateKeyOf(oldTs));
    await seedDaily(db, dateKeyOf(isoDaysAgo(1)));

    const res = await repo.applyUsageRetention();
    expect(res).toMatchObject({ enabled: true, days: 30, deleted: 1 });

    const kept = db.all(`SELECT usageEventId FROM usageHistory`);
    expect(kept.map((r) => r.usageEventId)).toEqual(["new-1"]);
    // daily aggregates survive — they are the long-term view
    expect(db.all(`SELECT dateKey FROM usageDaily`).length).toBe(2);
  });

  it("runs automatically on a safe cycle after a successful usage write", async () => {
    process.env.USAGE_RETENTION_DAYS = "30";
    const { repo, getAdapter } = await loadRepo();
    const db = await getAdapter();
    await seedHistory(db, isoDaysAgo(100), "old-auto");

    await repo.saveRequestUsage({ provider: "p", model: "m", tokens: { prompt_tokens: 1, completion_tokens: 1 } });

    const ids = db.all(`SELECT usageEventId FROM usageHistory`).map((r) => r.usageEventId);
    expect(ids).not.toContain("old-auto");
    expect(ids.length).toBe(1); // only the fresh event remains
  });

  it("never deletes rows whose timestamp is not well-formed ISO (uncomparable formats)", async () => {
    process.env.USAGE_RETENTION_DAYS = "30";
    const { repo, getAdapter } = await loadRepo();
    const db = await getAdapter();
    await seedHistory(db, "1700000000000", "epoch-row"); // numeric epoch as text
    await seedHistory(db, "not-a-date", "junk-row");

    const res = await repo.applyUsageRetention();
    expect(res.deleted).toBe(0);
    expect(db.all(`SELECT id FROM usageHistory`).length).toBe(2);
  });

  it("a retention failure must never surface from the request write path", async () => {
    process.env.USAGE_RETENTION_DAYS = "30";
    const { repo, getAdapter } = await loadRepo();
    const db = await getAdapter();
    await seedHistory(db, isoDaysAgo(100), "old-1");
    // Break DELETE by dropping the table underneath; the write itself must still resolve
    db.exec(`DROP TABLE usageHistory`);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(repo.saveRequestUsage({ provider: "p", model: "m", tokens: {} })).resolves.toBeUndefined();
    errSpy.mockRestore();
  });
});
