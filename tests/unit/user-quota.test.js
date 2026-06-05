// Per-key token quota — window math, budget resolution, and accounting dedupe.
// Covers the review findings on PR #1569: non-streaming requests must be charged
// exactly once via the explicit countsTowardQuota marker (not endpoint IS NULL).
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

// Ghi 1 row usage canonical (countsTowardQuota = 1) cho apiKey
async function writeCanonical(apiKey, promptTokens, extra = {}) {
  await usageRepo.saveRequestUsage({
    provider: "openai", model: "gpt-4", connectionId: "c1",
    apiKey, tokens: { prompt_tokens: promptTokens, completion_tokens: 1 },
    countsTowardQuota: true, ...extra,
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

describe("checkUserQuota — accounting (countsTowardQuota marker)", () => {
  beforeAll(async () => {
    await db.updateSettings({ userQuotaEnabled: true, userTokenBudget5hDefault: 1000 });
  });

  it("streaming dual-write counts exactly once", async () => {
    const key = "sk-stream";
    await usageRepo.checkUserQuota(key); // mở window trước (giống handleChat: check rồi mới ghi usage)
    // Row canonical (logUsage: endpoint null, flagged)
    await writeCanonical(key, 400);
    // Row duplicate (onStreamComplete: endpoint set, KHÔNG flag)
    await usageRepo.saveRequestUsage({
      provider: "openai", model: "gpt-4", connectionId: "c1",
      apiKey: key, tokens: { prompt_tokens: 400, completion_tokens: 1 },
      endpoint: "/v1/chat/completions",
    });

    const res = await usageRepo.checkUserQuota(key);
    expect(res.used).toBe(400); // không phải 800
    expect(res.allowed).toBe(true);
  });

  it("non-streaming single write (endpoint set + flagged) is charged", async () => {
    const key = "sk-nonstream";
    await usageRepo.checkUserQuota(key); // mở window trước
    await writeCanonical(key, 300, { endpoint: "/v1/chat/completions" });

    const res = await usageRepo.checkUserQuota(key);
    expect(res.used).toBe(300);
  });

  it("over budget → blocked with retry info", async () => {
    const key = "sk-over";
    await usageRepo.checkUserQuota(key); // mở window trước
    await writeCanonical(key, 600);
    await writeCanonical(key, 600);

    const res = await usageRepo.checkUserQuota(key);
    expect(res.used).toBe(1200);
    expect(res.budget).toBe(1000);
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
    await writeCanonical(key, 5000, { timestamp: sixHoursAgo });

    const res = await usageRepo.checkUserQuota(key);
    expect(new Date(res.windowStart).getTime()).toBeGreaterThan(new Date(sixHoursAgo).getTime());
    expect(res.used).toBe(0); // usage của window cũ không tính sang window mới
    expect(res.allowed).toBe(true);
  });
});

describe("checkUserQuota — per-key budget override", () => {
  it("apiKeys.tokenBudget5h overrides the global default", async () => {
    const key = "sk-override";
    adapter.run(
      `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, tokenBudget5h) VALUES(?, ?, ?, ?, 1, ?, ?)`,
      ["id-override", key, "override", "m1", new Date().toISOString(), 200]
    );
    await usageRepo.checkUserQuota(key); // mở window trước
    await writeCanonical(key, 250);

    const res = await usageRepo.checkUserQuota(key);
    expect(res.budget).toBe(200);
    expect(res.allowed).toBe(false);
  });

  it("updateApiKey persists tokenBudget5h and rowToKey exposes it", async () => {
    const keysRepo = await import("@/lib/db/repos/apiKeysRepo.js");
    adapter.run(
      `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt) VALUES(?, ?, ?, ?, 1, ?)`,
      ["id-crud", "sk-crud", "crud", "m1", new Date().toISOString()]
    );

    const updated = await keysRepo.updateApiKey("id-crud", { tokenBudget5h: 12345 });
    expect(updated.tokenBudget5h).toBe(12345);

    const fetched = await keysRepo.getApiKeyById("id-crud");
    expect(fetched.tokenBudget5h).toBe(12345);

    // Clear override → quay về default toàn cục
    const cleared = await keysRepo.updateApiKey("id-crud", { tokenBudget5h: null });
    expect(cleared.tokenBudget5h).toBe(null);
  });
});
