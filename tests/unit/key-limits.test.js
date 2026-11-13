// Per-API-key limits: expiry + daily / weekly / monthly USD budgets, and the
// per-key usage report. Enforcement runs against a mocked repo; spend and
// report queries run against a real temp SQLite DB.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { quotaPeriodBounds, validateKeyLimitsInput, keyBudgets, keyLimitStatus } from "../../src/shared/utils/keyQuota.js";

const now = new Date(2026, 9, 22, 15, 30); // Thu 22 Oct 2026, local time

describe("quotaPeriodBounds", () => {
  it("rolling 5h / week (Monday) / month", () => {
    expect(quotaPeriodBounds("5h", now).start).toEqual(new Date(2026, 9, 22, 10, 30));
    expect(quotaPeriodBounds("week", now)).toEqual({ start: new Date(2026, 9, 19), end: new Date(2026, 9, 26) });
    expect(quotaPeriodBounds("month", now)).toEqual({ start: new Date(2026, 9, 1), end: new Date(2026, 10, 1) });
    // Sunday belongs to the week that started the previous Monday.
    expect(quotaPeriodBounds("week", new Date(2026, 9, 25, 9)).start).toEqual(new Date(2026, 9, 19));
  });
});

describe("validateKeyLimitsInput / keyBudgets", () => {
  it("accepts, clears and rejects", () => {
    expect(validateKeyLimitsInput({ quota5hUsd: "5", quotaMonthlyUsd: 100 })).toEqual({ ok: true, value: { quota5hUsd: 5, quotaMonthlyUsd: 100 } });
    expect(validateKeyLimitsInput({ quotaWeeklyUsd: "", expiresAt: null })).toEqual({ ok: true, value: { quotaWeeklyUsd: null, expiresAt: null } });
    expect(validateKeyLimitsInput({ isActive: true, name: "x" })).toEqual({ ok: true, value: {} });
    expect(validateKeyLimitsInput({ quota5hUsd: -1 }).ok).toBe(false);
    expect(validateKeyLimitsInput({ quotaWeeklyUsd: "abc" }).ok).toBe(false);
    expect(validateKeyLimitsInput({ expiresAt: "nope" }).ok).toBe(false);
  });

  it("lists only the budgets that are set", () => {
    expect(keyBudgets({ quota5hUsd: 2, quotaWeeklyUsd: null, quotaMonthlyUsd: 50 }).map((b) => [b.id, b.limit]))
      .toEqual([["5h", 2], ["month", 50]]);
  });
});

describe("checkKeyLimits", () => {
  const fx = { spend: null };
  let checkKeyLimits;
  // 5h window: oldest request in the window was at 11:00, so it frees up at 16:00.
  const spendOf = (h5, week, month) => {
    const b = (p) => quotaPeriodBounds(p, now);
    return {
      "5h": { spent: h5, start: b("5h").start, end: new Date(2026, 9, 22, 16, 0) },
      week: { spent: week, ...b("week") },
      month: { spent: month, ...b("month") },
    };
  };

  beforeAll(async () => {
    vi.resetModules();
    vi.doMock("@/lib/db/repos/apiKeysRepo.js", () => ({ getApiKeyByKey: async () => null, getApiKeyPeriodSpend: async () => fx.spend }));
    vi.doMock("@/lib/db/repos/combosRepo.js", () => ({ getCombos: async () => [] }));
    vi.doMock("@/sse/utils/logger.js", () => ({ warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }));
    ({ checkKeyLimits } = await import("../../src/sse/services/keyAccess.js"));
  });
  afterAll(() => { vi.doUnmock("@/lib/db/repos/apiKeysRepo.js"); vi.doUnmock("@/lib/db/repos/combosRepo.js"); vi.doUnmock("@/sse/utils/logger.js"); });

  const base = { id: "k1", name: "dev", key: "sk-1", expiresAt: null, quota5hUsd: null, quotaWeeklyUsd: null, quotaMonthlyUsd: null };

  it("passes keys without limits", async () => {
    expect(await checkKeyLimits(base, now)).toBeNull();
  });

  it("401s an expired key, non-retryable", async () => {
    const r = await checkKeyLimits({ ...base, expiresAt: new Date(2026, 9, 1).toISOString() }, now);
    expect(r.status).toBe(401);
    expect(r.headers.get("x-should-retry")).toBe("false");
    expect((await r.json()).error.code).toBe("key_expired");
  });

  it("checks every budget; under all of them passes", async () => {
    fx.spend = spendOf(4.99, 20, 90);
    expect(await checkKeyLimits({ ...base, quota5hUsd: 5, quotaWeeklyUsd: 25, quotaMonthlyUsd: 100 }, now)).toBeNull();
  });

  it("429s on the 5h budget with retry-after until its oldest request ages out", async () => {
    fx.spend = spendOf(5, 20, 90);
    const r = await checkKeyLimits({ ...base, quota5hUsd: 5, quotaMonthlyUsd: 100 }, now);
    expect(r.status).toBe(429);
    expect(r.headers.get("x-should-retry")).toBe("false");
    expect(r.headers.get("retry-after")).toBe(String(30 * 60));
    const body = await r.json();
    expect(body.type).toBe("error");
    expect(body.error).toMatchObject({ type: "rate_limit_error", code: "quota_exceeded" });
    expect(body.error.message).toContain("5-hour budget");
  });

  it("when several budgets are hit, reports the one blocking longest", async () => {
    fx.spend = spendOf(6, 30, 120);
    const r = await checkKeyLimits({ ...base, quota5hUsd: 5, quotaWeeklyUsd: 25, quotaMonthlyUsd: 100 }, now);
    expect((await r.json()).error.message).toContain("monthly budget");
    expect(r.headers.get("retry-after")).toBe(String((new Date(2026, 10, 1) - now) / 1000));
  });
});

describe("spend + usage report (real DB)", () => {
  let tempDir, repo, adapter;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-key-limits-"));
    process.env.DATA_DIR = tempDir;
    vi.resetModules();
    const db = await import("@/lib/db/index.js");
    await db.initDb();
    repo = await import("@/lib/db/repos/apiKeysRepo.js");
    adapter = await (await import("@/lib/db/driver.js")).getAdapter();
    const add = (when, key, model, cost, p = 100, c = 50) => adapter.run(
      `INSERT INTO usageHistory(timestamp, provider, model, apiKey, promptTokens, completionTokens, cost, status) VALUES(?, 'openai', ?, ?, ?, ?, ?, 'ok')`,
      [when.toISOString(), model, key, p, c, cost]
    );
    add(new Date(2026, 9, 22, 11), "sk-a", "gpt-5", 1.5);       // in the 5h window
    add(new Date(2026, 9, 22, 9), "sk-a", "gpt-5", 0.5);        // today, before the 5h window
    add(new Date(2026, 9, 20, 9), "sk-a", "gpt-5-mini", 0.25);  // this week
    add(new Date(2026, 9, 2, 9), "sk-a", "gpt-5", 3);           // this month
    add(new Date(2026, 8, 30, 9), "sk-a", "gpt-5", 100);        // last month
    add(new Date(2026, 9, 22, 10), "sk-b", "gpt-5", 7);         // other key
  });
  afterAll(() => { delete process.env.DATA_DIR; });

  it("sums spend per period for the key only; 5h frees up when its oldest request ages out", async () => {
    const s = await repo.getApiKeyPeriodSpend("sk-a", now);
    expect(s["5h"].spent).toBeCloseTo(1.5);
    expect(s["5h"].end).toEqual(new Date(2026, 9, 22, 16, 0));
    expect(s.week.spent).toBeCloseTo(2.25);
    expect(s.month.spent).toBeCloseTo(5.25);
  });

  it("keyLimitStatus reports every period, set or not", async () => {
    const s = keyLimitStatus({ name: "dev", quota5hUsd: 1.5, quotaWeeklyUsd: 10 }, await repo.getApiKeyPeriodSpend("sk-a", now), now);
    expect(s).toMatchObject({ object: "key_limits", name: "dev", expired: false, blocked: true });
    expect(s.limits.map((l) => [l.period, l.limit_usd, l.blocked])).toEqual([["5h", 1.5, true], ["week", 10, false], ["month", null, false]]);
    expect(s.limits[1]).toMatchObject({ used_usd: 2.25, remaining_usd: 7.75, utilization: 0.225 });
    expect(s).not.toHaveProperty("key");
  });

  it("builds a zero-filled daily series and a by-model breakdown", async () => {
    const r = await repo.getApiKeyUsageReport("sk-a", 7, now);
    expect(r.daily).toHaveLength(7);
    expect(r.daily.at(-1)).toMatchObject({ date: "2026-10-22", requests: 2, cost: 2 });
    expect(r.daily.find((d) => d.date === "2026-10-21").requests).toBe(0);
    expect(r.totals).toMatchObject({ requests: 3, promptTokens: 300, completionTokens: 150 });
    expect(r.byModel.map((m) => m.model)).toEqual(["gpt-5", "gpt-5-mini"]);
  });

  it("stores limits on create and update", async () => {
    const k = await repo.createApiKey("ci", "machine-1", { quota5hUsd: 2, expiresAt: "2027-01-01T00:00:00.000Z" });
    expect(await repo.getApiKeyById(k.id)).toMatchObject({ quota5hUsd: 2, quotaWeeklyUsd: null, expiresAt: "2027-01-01T00:00:00.000Z" });
    const u = await repo.updateApiKey(k.id, { quota5hUsd: null, quotaMonthlyUsd: 40 });
    expect(u).toMatchObject({ quota5hUsd: null, quotaMonthlyUsd: 40, expiresAt: "2027-01-01T00:00:00.000Z" });
    expect(await repo.validateApiKey(k.key)).toBe(true);
    await repo.updateApiKey(k.id, { expiresAt: "2020-01-01T00:00:00.000Z" });
    expect(await repo.validateApiKey(k.key)).toBe(false);
  });
});
