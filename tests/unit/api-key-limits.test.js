import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let limits;

async function insertUsage(apiKey, { tokens = 0, output = 0, cost = 0, timestamp = new Date().toISOString() } = {}) {
  const adapter = await db.getAdapterForTest();
  adapter.run(
    `INSERT INTO usageHistory(timestamp, provider, model, apiKey, promptTokens, completionTokens, cost, status) VALUES(?, 'openai', 'gpt-test', ?, ?, ?, ?, 'ok')`,
    [timestamp, apiKey, tokens, output, cost]
  );
  // Same signal saveRequestUsage emits → drops the cached totals
  db.statsEmitter.emit("apiKeyUsage", apiKey);
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-api-key-limits-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  delete global._apiKeyLimitState;
  vi.resetModules();
  const dbIndex = await import("@/lib/db/index.js");
  const { getAdapter } = await import("@/lib/db/driver.js");
  db = { ...dbIndex, getAdapterForTest: getAdapter };
  limits = await import("@/lib/apiKeyLimits.js");
});

afterAll(() => {
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  delete global._dbAdapter;
  delete global._apiKeyLimitState;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("API key limits", () => {
  it("stores and normalizes limits (0/empty = unlimited)", async () => {
    const key = await db.createApiKey("normalize", "machine-1", { rpmLimit: "10.7", dailyTokenLimit: 0, monthlyBudget: "" });
    expect(key.rpmLimit).toBe(10);
    expect(key.dailyTokenLimit).toBeNull();
    expect(key.monthlyBudget).toBeNull();
    expect(key.monthlyOutputTokenLimit).toBeNull();

    const updated = await db.updateApiKey(key.id, { monthlyBudget: 5.5, rpmLimit: null });
    expect(updated.rpmLimit).toBeNull();
    expect(updated.monthlyBudget).toBe(5.5);
    expect((await db.getApiKeyByKey(key.key)).monthlyBudget).toBe(5.5);
  });

  it("allows unknown keys and keys without limits", async () => {
    expect(await limits.checkApiKeyLimits("sk-unknown")).toBeNull();
    expect(await limits.checkApiKeyLimits(null)).toBeNull();
    const key = await db.createApiKey("unlimited", "machine-1");
    for (let i = 0; i < 20; i++) expect(await limits.checkApiKeyLimits(key.key)).toBeNull();
  });

  it("enforces requests per minute with a 429 + Retry-After", async () => {
    const key = await db.createApiKey("rpm", "machine-1", { rpmLimit: 3 });
    for (let i = 0; i < 3; i++) expect(await limits.enforceApiKeyLimits(key.key)).toBeNull();

    const res = await limits.enforceApiKeyLimits(key.key);
    expect(res.status).toBe(429);
    const retryAfter = Number(res.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect((await res.json()).error.message).toMatch(/3 requests\/minute/);
  });

  it("enforces the daily token limit and ignores usage from before today", async () => {
    const key = await db.createApiKey("tokens", "machine-1", { dailyTokenLimit: 1000 });
    const yesterday = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
    await insertUsage(key.key, { tokens: 5000, timestamp: yesterday });
    expect(await limits.checkApiKeyLimits(key.key)).toBeNull();

    await insertUsage(key.key, { tokens: 999 });
    expect(await limits.checkApiKeyLimits(key.key)).toBeNull();

    await insertUsage(key.key, { tokens: 1 });
    const blocked = await limits.checkApiKeyLimits(key.key);
    expect(blocked.message).toMatch(/daily tokens limit/);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it("enforces the monthly budget", async () => {
    const key = await db.createApiKey("budget", "machine-1", { monthlyBudget: 2 });
    await insertUsage(key.key, { cost: 1.5 });
    expect(await limits.checkApiKeyLimits(key.key)).toBeNull();
    await insertUsage(key.key, { cost: 0.5 });
    expect((await limits.checkApiKeyLimits(key.key)).message).toMatch(/monthly budget/);
  });

  it("enforces input and output token limits separately", async () => {
    const key = await db.createApiKey("in-out", "machine-1", { dailyInputTokenLimit: 100, monthlyOutputTokenLimit: 50 });
    await insertUsage(key.key, { tokens: 60, output: 49 });
    expect(await limits.checkApiKeyLimits(key.key)).toBeNull();

    await insertUsage(key.key, { tokens: 0, output: 1 });
    expect((await limits.checkApiKeyLimits(key.key)).message).toMatch(/monthly output tokens limit/);

    await db.updateApiKey(key.id, { monthlyOutputTokenLimit: null });
    limits.invalidateApiKeyLimitCache(key.key);
    await insertUsage(key.key, { tokens: 40 });
    expect((await limits.checkApiKeyLimits(key.key)).message).toMatch(/daily input tokens limit/);
  });

  it("enforces monthly token and request limits, counting earlier days of the month", async () => {
    const now = new Date();
    // Only meaningful when "yesterday" is still in this month
    const earlierThisMonth = now.getDate() > 1 ? new Date(now.getFullYear(), now.getMonth(), 1, 12).toISOString() : null;

    const tokenKey = await db.createApiKey("month-tokens", "machine-1", { monthlyTokenLimit: 1000, dailyTokenLimit: 900 });
    if (earlierThisMonth) await insertUsage(tokenKey.key, { tokens: 600, timestamp: earlierThisMonth });
    await insertUsage(tokenKey.key, { tokens: earlierThisMonth ? 400 : 1000, output: 0 });
    const blocked = await limits.checkApiKeyLimits(tokenKey.key);
    expect(blocked.message).toMatch(earlierThisMonth ? /monthly tokens limit/ : /tokens limit/);

    const reqKey = await db.createApiKey("month-requests", "machine-1", { monthlyRequestLimit: 2 });
    await insertUsage(reqKey.key);
    expect(await limits.checkApiKeyLimits(reqKey.key)).toBeNull();
    await insertUsage(reqKey.key);
    expect((await limits.checkApiKeyLimits(reqKey.key)).message).toMatch(/monthly requests limit/);
  });

  it("picks up limit changes after cache invalidation", async () => {
    const key = await db.createApiKey("change", "machine-1", { rpmLimit: 1 });
    expect(await limits.checkApiKeyLimits(key.key)).toBeNull();
    expect(await limits.checkApiKeyLimits(key.key)).not.toBeNull();

    await db.updateApiKey(key.id, { rpmLimit: null });
    limits.invalidateApiKeyLimitCache(key.key);
    expect(await limits.checkApiKeyLimits(key.key)).toBeNull();
  });

  it("reports usage vs limits for the dashboard", async () => {
    const key = await db.createApiKey("status", "machine-1", { rpmLimit: 10, dailyTokenLimit: 500, monthlyBudget: 3 });
    await insertUsage(key.key, { tokens: 120, cost: 0.25 });
    await limits.checkApiKeyLimits(key.key);

    const status = await limits.getApiKeyLimitStatus(await db.getApiKeyById(key.id));
    const byField = Object.fromEntries(status.limits.map((l) => [l.field, l]));
    expect(status.rpm).toEqual({ used: 1, limit: 10 });
    expect(byField.dailyTokenLimit).toMatchObject({ used: 120, limit: 500, always: true });
    expect(byField.monthlyBudget.used).toBeCloseTo(0.25);
    expect(byField.monthlyBudget).toMatchObject({ limit: 3, money: true });
    expect(byField.monthlyInputTokenLimit).toMatchObject({ used: 120, limit: null, always: false });
    expect(status.today.requests).toBe(1);
  });
});
