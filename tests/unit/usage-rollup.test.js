// Usage rollup pre-aggregation — usageRollupHourly/usageRollupDaily are
// upserted transactionally with each usageHistory insert (dimensions, token
// sums incl. cached/reasoning, in-row lastUsed), and migration 002 backfills
// them from pre-existing usageHistory rows.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-usage-rollup-"));
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

const TOKENS = { prompt_tokens: 100, completion_tokens: 40, cached_tokens: 80, reasoning_tokens: 12 };

describe("rollup dual-write in saveRequestUsage", () => {
  it("upserts one row per dimension with correct sums and lastUsed", async () => {
    await db.saveRequestUsage({
      provider: "glm", model: "glm-5.3", connectionId: "conn-1", apiKey: "sk-a",
      endpoint: "/v1/messages", tokens: { ...TOKENS }, meta: { requestedModel: "slow" },
      timestamp: "2026-01-01T01:02:03.000Z",
    });

    const a = await adapter();
    const h = a.all(`SELECT * FROM usageRollupHourly WHERE dimension = 'provider' AND dimKey = 'glm'`);
    expect(h.length).toBe(1);
    expect(h[0].model).toBe("glm-5.3");
    expect(h[0].requests).toBe(1);
    expect(h[0].promptTokens).toBe(100);
    expect(h[0].completionTokens).toBe(40);
    expect(h[0].cachedTokens).toBe(80);
    expect(h[0].reasoningTokens).toBe(12);
    expect(h[0].lastUsed).toBe("2026-01-01T01:02:03.000Z");

    // every dimension present, all carrying (model, provider) sub-keys —
    // the dashboard groups every dimension's rows per model+provider
    const dims = a.all(`SELECT DISTINCT dimension FROM usageRollupHourly`).map((r) => r.dimension).sort();
    expect(dims).toEqual(["account", "apiKey", "combo", "endpoint", "model", "provider"]);
    const sub = a.all(`SELECT DISTINCT model, provider FROM usageRollupHourly WHERE dimension IN ('account','apiKey','endpoint')`);
    expect(sub.every((r) => r.model === "glm-5.3" && r.provider === "glm")).toBe(true);
    const modelRow = a.get(`SELECT * FROM usageRollupHourly WHERE dimension = 'model'`);
    expect(modelRow.dimKey).toBe("glm-5.3|glm");
  });

  it("increments on repeat and keeps lastUsed = max(timestamp)", async () => {
    await db.saveRequestUsage({
      provider: "glm", model: "glm-5.3", connectionId: "conn-1", apiKey: "sk-a",
      endpoint: "/v1/messages", tokens: { ...TOKENS }, meta: { requestedModel: "slow" },
      timestamp: "2026-01-01T23:59:00.000Z",
    });
    const a = await adapter();
    // 01:02Z and 23:59Z may land on different local dates — assert over totals
    const h = a.get(`SELECT SUM(requests) requests, SUM(promptTokens) pt, MAX(lastUsed) lastUsed FROM usageRollupHourly WHERE dimension = 'provider' AND dimKey = 'glm'`);
    expect(h.requests).toBe(2);
    expect(h.pt).toBe(200);
    expect(h.lastUsed).toBe("2026-01-01T23:59:00.000Z");
  });

  it("buckets hours/days by local time and mirrors into usageRollupDaily", async () => {
    const a = await adapter();
    const hSum = a.get(`SELECT COALESCE(SUM(requests),0) n FROM usageRollupHourly WHERE dimension='provider' AND dimKey='glm'`).n;
    const dSum = a.get(`SELECT COALESCE(SUM(requests),0) n FROM usageRollupDaily WHERE dimension='provider' AND dimKey='glm'`).n;
    expect(hSum).toBe(2);
    expect(dSum).toBe(hSum); // daily mirrors hourly exactly
    const dHours = a.all(`SELECT DISTINCT hour FROM usageRollupHourly WHERE dimension = 'provider' AND dimKey = 'glm'`).map((r) => r.hour);
    expect(dHours.length).toBeGreaterThanOrEqual(1); // 01:02Z and 23:59Z are distinct local hours in UTC+7
  });

  it("dedupe-hit does not double-count rollups", async () => {
    const dup = {
      provider: "glm", model: "glm-5.3", connectionId: "conn-1", apiKey: "sk-a",
      endpoint: "/v1/messages", tokens: { ...TOKENS }, meta: { requestedModel: "slow" },
      timestamp: "2026-01-01T23:59:00.000Z",
    };
    await db.saveRequestUsage(dup);
    await db.saveRequestUsage(dup);
    const a = await adapter();
    const h = a.get(`SELECT SUM(requests) n FROM usageRollupHourly WHERE dimension = 'provider' AND dimKey = 'glm'`);
    expect(h.n).toBe(2); // still the two distinct inserts
  });
});

describe("migration 002 backfill from usageHistory", () => {
  it("rebuilds rollups from raw history rows", async () => {
    // Seed rows straight into usageHistory (as if written before the migration existed)
    const a = await adapter();
    a.run(`INSERT INTO usageHistory(timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens, meta)
           VALUES('2026-02-01T05:00:00.000Z', 'kiro', 'k-1', 'conn-9', null, '/v1/messages', 10, 5, 0.5, 'ok',
                  '{"prompt_tokens":10,"completion_tokens":5,"cached_tokens":4}', '{"requestedModel":"fast"}')`);
    a.run(`INSERT INTO usageHistory(timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens, meta)
           VALUES('2026-02-01T06:00:00.000Z', 'kiro', 'k-1', 'conn-9', null, '/v1/responses', 20, 8, 1.5, 'ok',
                  '{"prompt_tokens":20,"completion_tokens":8}', '{}')`);

    const before = a.get(`SELECT COALESCE(SUM(requests),0) n FROM usageRollupHourly WHERE dimension='provider' AND dimKey='kiro'`).n;
    const m002 = (await import("@/lib/db/migrations/002-usage-rollups.js")).default;
    a.transaction(() => m002.up(a));
    const after = a.get(`SELECT COALESCE(SUM(requests),0) n FROM usageRollupHourly WHERE dimension='provider' AND dimKey='kiro'`).n;

    expect(after - before).toBe(2);
    const combo = a.get(`SELECT * FROM usageRollupDaily WHERE dimension='combo' AND dimKey='fast'`);
    expect(combo.requests).toBe(1);
    expect(combo.promptTokens).toBe(10);
    expect(combo.cachedTokens).toBe(4);
    // apiKey NULL → 'local-no-key', endpoint default 'Unknown'
    expect(a.get(`SELECT * FROM usageRollupHourly WHERE dimension='apiKey' AND dimKey='local-no-key' AND dateKey >= '2026-02'`)).toBeTruthy();
  });
});
