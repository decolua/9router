// Per-key cost quota — window math, budget resolution, and accounting dedupe.
// Quota sums the cost column (per-model pricing: non-cached input / cached input /
// output weighted separately) of rows flagged countsTowardQuota = 1, so both
// streaming and non-streaming are charged exactly once. Models without pricing
// have cost 0 and are intentionally not charged (no token fallback).
//
// Built-in gpt-4 pricing used below (USD per 1M tokens):
//   input 2.50 | cached 1.25 | output 10.00
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const QUOTA_WINDOW_MS = 5 * 60 * 60 * 1000;

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let usageRepo;
let adapter;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-quota-"));
  process.env.DATA_DIR = tempDir;
  db = await import("@/lib/db/index.js");
  await db.initDb();
  usageRepo = await import("@/lib/db/repos/usageRepo.js");
  const driver = await import("@/lib/db/driver.js");
  adapter = await driver.getAdapter();
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

// Ghi 1 row usage canonical (countsTowardQuota = 1) cho apiKey, model gpt-4
async function writeCanonical(apiKey, tokens, extra = {}) {
  await usageRepo.saveRequestUsage({
    provider: "openai", model: "gpt-4", connectionId: "c1",
    apiKey, tokens, countsTowardQuota: true, ...extra,
  });
}

describe("checkUserQuota — enabled resolution", () => {
  it("disabled by default → always allowed", async () => {
    const res = await usageRepo.checkUserQuota("sk-default-off");
    expect(res.allowed).toBe(true);
    expect(res.disabled).toBe(true);
  });

  it("no apiKey → allowed", async () => {
    const res = await usageRepo.checkUserQuota(null);
    expect(res.allowed).toBe(true);
  });
});

describe("checkUserQuota — cost accounting (countsTowardQuota marker)", () => {
  beforeAll(async () => {
    await db.updateSettings({ userQuotaEnabled: true, userCostBudget5hDefault: 2.0 });
  });

  it("streaming dual-write counts exactly once", async () => {
    const key = "sk-stream";
    await usageRepo.checkUserQuota(key); // mở window trước (giống handleChat: check rồi mới ghi usage)
    // Row canonical (logUsage: endpoint null, flagged) — 400k input → $1.00
    await writeCanonical(key, { prompt_tokens: 400_000, completion_tokens: 0 });
    // Row duplicate (onStreamComplete: endpoint set, KHÔNG flag)
    await usageRepo.saveRequestUsage({
      provider: "openai", model: "gpt-4", connectionId: "c1",
      apiKey: key, tokens: { prompt_tokens: 400_000, completion_tokens: 0 },
      endpoint: "/v1/chat/completions",
    });

    const res = await usageRepo.checkUserQuota(key);
    expect(res.used).toBeCloseTo(1.0, 6); // không phải 2.0
    expect(res.allowed).toBe(true);
  });

  it("non-streaming single write (endpoint set + flagged) is charged", async () => {
    const key = "sk-nonstream";
    await usageRepo.checkUserQuota(key); // mở window trước
    await writeCanonical(key, { prompt_tokens: 200_000, completion_tokens: 0 }, { endpoint: "/v1/chat/completions" });

    const res = await usageRepo.checkUserQuota(key);
    expect(res.used).toBeCloseTo(0.5, 6);
  });

  it("output tokens are weighted (4x input for gpt-4)", async () => {
    const key = "sk-output";
    await usageRepo.checkUserQuota(key);
    // 100k input ($0.25) + 100k output ($1.00) = $1.25
    await writeCanonical(key, { prompt_tokens: 100_000, completion_tokens: 100_000 });

    const res = await usageRepo.checkUserQuota(key);
    expect(res.used).toBeCloseTo(1.25, 6);
  });

  it("cached input is discounted (0.5x input for gpt-4)", async () => {
    const key = "sk-cached";
    await usageRepo.checkUserQuota(key);
    // 1M input trong đó 900k cached: 100k×2.5 + 900k×1.25 = $1.375
    await writeCanonical(key, { prompt_tokens: 1_000_000, completion_tokens: 0, cached_tokens: 900_000 });

    const res = await usageRepo.checkUserQuota(key);
    expect(res.used).toBeCloseTo(1.375, 6);
  });

  it("model without pricing → cost 0, intentionally not charged", async () => {
    const key = "sk-nopricing";
    await usageRepo.checkUserQuota(key);
    await usageRepo.saveRequestUsage({
      provider: "nopricing", model: "model-without-pricing", connectionId: "c1",
      apiKey: key, tokens: { prompt_tokens: 99_000_000, completion_tokens: 1_000_000 },
      countsTowardQuota: true,
    });

    const res = await usageRepo.checkUserQuota(key);
    expect(res.used).toBe(0);
    expect(res.allowed).toBe(true);
  });

  it("over budget → blocked with retry info", async () => {
    const key = "sk-over";
    await usageRepo.checkUserQuota(key); // mở window trước
    await writeCanonical(key, { prompt_tokens: 600_000, completion_tokens: 0 }); // $1.50
    await writeCanonical(key, { prompt_tokens: 600_000, completion_tokens: 0 }); // $1.50

    const res = await usageRepo.checkUserQuota(key);
    expect(res.used).toBeCloseTo(3.0, 6);
    expect(res.budget).toBe(2.0);
    expect(res.allowed).toBe(false);
    expect(res.retryAfterSec).toBeGreaterThan(0);
    expect(res.retryAfterSec).toBeLessThanOrEqual(QUOTA_WINDOW_MS / 1000);
    expect(res.resetAtLocal).toContain("UTC"); // offset tường minh
    expect(new Date(res.retryAfterIso).getTime()).toBe(
      new Date(res.windowStart).getTime() + QUOTA_WINDOW_MS
    );
  });
});

describe("checkUserQuota — window math", () => {
  it("first request anchors the window", async () => {
    const key = "sk-window";
    const before = Date.now();
    const res = await usageRepo.checkUserQuota(key);
    const start = new Date(res.windowStart).getTime();
    expect(start).toBeGreaterThanOrEqual(before);
    expect(start).toBeLessThanOrEqual(Date.now());

    // Lần check tiếp theo trong cùng window → giữ nguyên anchor
    const res2 = await usageRepo.checkUserQuota(key);
    expect(res2.windowStart).toBe(res.windowStart);
  });

  it("expired window (>5h) → new window opens and usage resets", async () => {
    const key = "sk-expired";
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

    // Window cũ đã hết hạn, usage cũ nằm trong window cũ
    adapter.run(
      `INSERT INTO userQuotaWindow(apiKey, windowStart) VALUES(?, ?)`,
      [key, sixHoursAgo]
    );
    await writeCanonical(key, { prompt_tokens: 5_000_000, completion_tokens: 0 }, { timestamp: sixHoursAgo });

    const res = await usageRepo.checkUserQuota(key);
    expect(new Date(res.windowStart).getTime()).toBeGreaterThan(new Date(sixHoursAgo).getTime());
    expect(res.used).toBe(0); // usage của window cũ không tính sang window mới
    expect(res.allowed).toBe(true);
  });
});

describe("checkUserQuota — per-key budget override", () => {
  it("apiKeys.costBudget5h overrides the global default", async () => {
    const key = "sk-override";
    adapter.run(
      `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, costBudget5h) VALUES(?, ?, ?, ?, 1, ?, ?)`,
      ["id-override", key, "override", "m1", new Date().toISOString(), 0.3]
    );
    await usageRepo.checkUserQuota(key); // mở window trước
    await writeCanonical(key, { prompt_tokens: 200_000, completion_tokens: 0 }); // $0.50

    const res = await usageRepo.checkUserQuota(key);
    expect(res.budget).toBe(0.3);
    expect(res.allowed).toBe(false);
  });

  it("updateApiKey persists costBudget5h and rowToKey exposes it", async () => {
    const keysRepo = await import("@/lib/db/repos/apiKeysRepo.js");
    adapter.run(
      `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt) VALUES(?, ?, ?, ?, 1, ?)`,
      ["id-crud", "sk-crud", "crud", "m1", new Date().toISOString()]
    );

    const updated = await keysRepo.updateApiKey("id-crud", { costBudget5h: 1.5 });
    expect(updated.costBudget5h).toBe(1.5);

    const fetched = await keysRepo.getApiKeyById("id-crud");
    expect(fetched.costBudget5h).toBe(1.5);

    // Clear override → quay về default toàn cục
    const cleared = await keysRepo.updateApiKey("id-crud", { costBudget5h: null });
    expect(cleared.costBudget5h).toBe(null);
  });
});
