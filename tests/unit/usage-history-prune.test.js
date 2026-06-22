// Regression test for #1245 — usageHistory grows unboundedly without pruning,
// causing severe memory leak (80MB → 4.8GB over 3 days) especially under the
// sql.js fallback where the entire DB lives in WASM heap.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalMaxRows = process.env.USAGE_HISTORY_MAX_ROWS;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-usage-prune-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  // Reset module-scope `writesSincePrune` counter by clearing the cache so the
  // imported module gets a fresh closure with our env var applied.
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalMaxRows === undefined) delete process.env.USAGE_HISTORY_MAX_ROWS;
  else process.env.USAGE_HISTORY_MAX_ROWS = originalMaxRows;
});

describe("usageHistory pruning (#1245)", () => {
  it("trims oldest rows once total exceeds USAGE_HISTORY_MAX_ROWS", async () => {
    // Small cap so the test runs fast — must be ≥100 (module clamps lower values).
    process.env.USAGE_HISTORY_MAX_ROWS = "100";

    const { saveRequestUsage } = await import("@/lib/db/repos/usageRepo.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();

    // Insert enough entries to trip the prune check (every 50 writes) and
    // overshoot the cap of 100 by a healthy margin.
    const TOTAL_INSERTS = 250;
    for (let i = 0; i < TOTAL_INSERTS; i++) {
      await saveRequestUsage({
        provider: "test",
        model: `model-${i}`,
        connectionId: "conn-1",
        apiKey: "key-1",
        endpoint: "/v1/chat/completions",
        status: "ok",
        tokens: { prompt_tokens: 10, completion_tokens: 20 },
      });
    }

    const { c: rowCount } = db.get(`SELECT COUNT(*) as c FROM usageHistory`);
    expect(rowCount).toBeLessThanOrEqual(100);
    // Should be near the cap (within one prune-throttle window).
    expect(rowCount).toBeGreaterThanOrEqual(50);

    // Oldest rows (lowest ids) should be gone — the surviving rows should be
    // the most-recently inserted ones.
    const surviving = db.all(`SELECT model FROM usageHistory ORDER BY id ASC LIMIT 1`);
    const oldestSurvivingIdx = parseInt(surviving[0].model.split("-")[1], 10);
    expect(oldestSurvivingIdx).toBeGreaterThan(0);

    const newest = db.all(`SELECT model FROM usageHistory ORDER BY id DESC LIMIT 1`);
    expect(newest[0].model).toBe(`model-${TOTAL_INSERTS - 1}`);
  });

  it("usageDaily retains aggregates after history pruning", async () => {
    process.env.USAGE_HISTORY_MAX_ROWS = "100";

    const { saveRequestUsage } = await import("@/lib/db/repos/usageRepo.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();

    for (let i = 0; i < 200; i++) {
      await saveRequestUsage({
        provider: "test",
        model: "m",
        tokens: { prompt_tokens: 5, completion_tokens: 7 },
      });
    }

    const daily = db.all(`SELECT data FROM usageDaily`);
    expect(daily.length).toBeGreaterThanOrEqual(1);
    const day = JSON.parse(daily[0].data);
    // All 200 requests should still be aggregated even though raw rows pruned.
    expect(day.requests).toBe(200);
    expect(day.promptTokens).toBe(200 * 5);
    expect(day.completionTokens).toBe(200 * 7);
  });

  it("defaults to 10000 rows when env var unset", async () => {
    delete process.env.USAGE_HISTORY_MAX_ROWS;
    const mod = await import("@/lib/db/repos/usageRepo.js");
    // Indirect check: insert a few rows, ensure none pruned (well below default 10k).
    for (let i = 0; i < 10; i++) {
      await mod.saveRequestUsage({ provider: "p", model: "m", tokens: { prompt_tokens: 1, completion_tokens: 1 } });
    }
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const { c } = db.get(`SELECT COUNT(*) as c FROM usageHistory`);
    expect(c).toBe(10);
  });

  it("rejects env value below 100 and falls back to default", async () => {
    process.env.USAGE_HISTORY_MAX_ROWS = "5";
    await import("@/lib/db/repos/usageRepo.js");
    // Module clamps via "v >= 100" — too low → 10000 default applies. Verifying
    // by inserting 20 rows: with a real cap of 5 they'd be pruned, with 10k they survive.
    const { saveRequestUsage } = await import("@/lib/db/repos/usageRepo.js");
    for (let i = 0; i < 200; i++) {
      await saveRequestUsage({ provider: "p", model: "m", tokens: { prompt_tokens: 1, completion_tokens: 1 } });
    }
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const { c } = db.get(`SELECT COUNT(*) as c FROM usageHistory`);
    expect(c).toBe(200);
  });
});
