import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// The tuner could not demote a dead model because nothing ever told it one had
// failed. Two independent reasons, both covered here:
//
//   1. requestDetails — the tuner's only error source — is gated behind
//      `enableObservability`, which upstream defaulted to false on 2026-08-01.
//      Production stopped writing that table on 2026-08-05 and nobody noticed
//      for eighteen days, because a model with no rows reads back ok=0 err=0
//      and `h = (ok===0 && err===0) ? 0.5 : …` calls that "no opinion", not
//      "no data".
//   2. Even switched on, it would not have helped: a cascade member that fails
//      never reaches that table at all. attemptModel() recorded the failure
//      into an in-memory Map that dies with the process.
//
// So health is now written at the routing seam, into its own table, with no
// config gate. These tests pin exactly that: the write happens, it is keyed by
// the routed id the tuner scores, and no setting can switch it off.

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-mhealth-"));
const originalDataDir = process.env.DATA_DIR;

let recordModelOutcome, getModelHealthWindow, clearModelHealthRows, hourBucket, RETENTION_DAYS;
let recordModelFailure, recordModelSuccess, clearModelHealth;
let getAdapter, updateSettings;

beforeAll(async () => {
  process.env.DATA_DIR = tempDir;
  ({ recordModelOutcome, getModelHealthWindow, clearModelHealthRows, hourBucket, RETENTION_DAYS } =
    await import("../../src/lib/db/repos/modelHealthRepo.js"));
  ({ recordModelFailure, recordModelSuccess, clearModelHealth } =
    await import("../../open-sse/services/modelHealth.js"));
  ({ getAdapter } = await import("../../src/lib/db/driver.js"));
  ({ updateSettings } = await import("../../src/lib/db/repos/settingsRepo.js"));
});

afterAll(() => {
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(async () => {
  clearModelHealth();
  await clearModelHealthRows();
});

// The seam is fire-and-forget by design — health bookkeeping must never make a
// request wait, or fail one. Poll rather than await so the production path
// keeps its floating promise.
async function settle(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await getModelHealthWindow();
    if (predicate(rows)) return rows;
    if (Date.now() > deadline) return rows;
    await new Promise((r) => setTimeout(r, 20));
  }
}

const find = (rows, id) => rows.find((r) => r.modelId === id);

describe("model health persistence", () => {
  it("keys rows by the routed id, not a provider/model pair", async () => {
    await recordModelOutcome("bb/gpt-5.5", "err");
    const rows = await getModelHealthWindow();
    expect(find(rows, "bb/gpt-5.5")).toMatchObject({ ok: 0, err: 1 });
  });

  it("accumulates repeated outcomes into one hourly bucket", async () => {
    const at = Date.UTC(2026, 7, 23, 15, 5);
    for (let i = 0; i < 9; i++) await recordModelOutcome("bb/gpt-5.5", "err", at + i * 1000);
    await recordModelOutcome("bb/gpt-5.5", "ok", at + 30 * 1000);

    const db = await getAdapter();
    const buckets = db.all(`SELECT bucket, ok, err FROM modelHealth WHERE modelId = 'bb/gpt-5.5'`);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toMatchObject({ bucket: hourBucket(at), ok: 1, err: 9 });
  });

  it("records the last success and failure times separately", async () => {
    const at = Date.UTC(2026, 7, 23, 15, 0);
    await recordModelOutcome("x/m", "ok", at);
    await recordModelOutcome("x/m", "err", at + 60_000);
    const row = find(await getModelHealthWindow(999_999), "x/m");
    expect(row.lastOkAt).toBe(new Date(at).toISOString());
    expect(row.lastErrAt).toBe(new Date(at + 60_000).toISOString());
  });

  it("a cascade failure reaches the database, not just the in-memory run", async () => {
    recordModelFailure("bb/gpt-5.5");
    const rows = await settle((r) => find(r, "bb/gpt-5.5")?.err === 1);
    expect(find(rows, "bb/gpt-5.5")).toMatchObject({ err: 1 });
  });

  it("a cascade success reaches the database too", async () => {
    recordModelSuccess("ag/claude-opus-4-6-thinking");
    const rows = await settle((r) => find(r, "ag/claude-opus-4-6-thinking")?.ok === 1);
    expect(find(rows, "ag/claude-opus-4-6-thinking")).toMatchObject({ ok: 1 });
  });

  // The whole bug in one assertion: observability off must not mean health off.
  it("writes with observability switched off", async () => {
    await updateSettings({ enableObservability: false });
    recordModelFailure("bb/gpt-5.5");
    const rows = await settle((r) => find(r, "bb/gpt-5.5")?.err === 1);
    expect(find(rows, "bb/gpt-5.5")).toMatchObject({ err: 1 });
  });

  it("retains a per-model window rather than a global row cap", async () => {
    const now = Date.now();
    const stale = now - (RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000;
    const db = await getAdapter();
    // A chatty model cannot evict a quiet one: retention is by age, and each
    // model gets its own buckets. requestDetails pruned to a single global cap,
    // which is why a 1-day window could read back empty for the model you care
    // about while another model filled the table.
    db.run(`INSERT INTO modelHealth(modelId, bucket, ok, err) VALUES(?, ?, 0, 1)`, ["old/model", hourBucket(stale)]);
    for (let i = 0; i < 500; i++) {
      db.run(`INSERT INTO modelHealth(modelId, bucket, ok, err) VALUES(?, ?, 1, 0)`, [`chatty/m${i}`, hourBucket(now)]);
    }
    await recordModelOutcome("quiet/model", "err", now);
    expect(find(await getModelHealthWindow(), "quiet/model")).toMatchObject({ err: 1 });

    // Prune is due (nothing has run in this fresh process), so the stale bucket goes.
    expect(db.get(`SELECT COUNT(*) c FROM modelHealth WHERE modelId = 'old/model'`).c).toBe(0);
  });
});
