import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDbAdapterForTests } from "../../src/lib/db/driver.js";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-api-key-manager-"));
  process.env.DATA_DIR = tempDir;
  resetDbAdapterForTests();
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterEach(() => {
  resetDbAdapterForTests();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("API key manager", () => {
  it("defaults existing API keys to unlimited with usage summary", async () => {
    const key = await db.createApiKey("unlimited", "machine-abc");
    await db.saveRequestUsage({
      provider: "openai",
      model: "gpt-4",
      apiKey: key.key,
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const keys = await db.getApiKeys({ includeUsage: true });
    expect(keys[0]).toMatchObject({ limitMode: "unlimited", status: "active" });
    expect(keys[0].usage.totalUsed).toBe(15);
    expect(await db.validateApiKey(key.key)).toBe(true);
  });

  it("rejects a hard-capped key after token limit is reached", async () => {
    const key = await db.createApiKey("hard", "machine-abc", {
      limitMode: "hard",
      tokenLimit: 20,
    });
    await db.saveRequestUsage({
      provider: "openai",
      model: "gpt-4",
      apiKey: key.key,
      tokens: { prompt_tokens: 12, completion_tokens: 8 },
    });

    const access = await db.checkApiKeyAccess(key.key);
    expect(access.valid).toBe(false);
    expect(access.reason).toBe("token_limit_exceeded");
    expect(access.status).toBe("exhausted");
  });

  it("tracks all-time daily and weekly usage and can reset periods", async () => {
    const key = await db.createApiKey("usage", "machine-abc", {
      limitMode: "daily",
      tokenLimit: 100,
    });
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    await db.saveRequestUsage({
      timestamp: now.toISOString(),
      provider: "openai",
      model: "gpt-4",
      apiKey: key.key,
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
    });
    await db.saveRequestUsage({
      timestamp: yesterday.toISOString(),
      provider: "openai",
      model: "gpt-4",
      apiKey: key.key,
      tokens: { prompt_tokens: 20, completion_tokens: 5 },
    });

    let usageKey = await db.getApiKeyById(key.id, { includeUsage: true });
    expect(usageKey.usage.periods.allTime.used).toBe(40);
    expect(usageKey.usage.periods.daily.used).toBe(15);
    expect(usageKey.usage.periods.weekly.used).toBeGreaterThanOrEqual(15);

    const dailyReset = await db.resetApiKeyUsage(key.id, "daily");
    expect(dailyReset.deleted).toBe(1);

    usageKey = await db.getApiKeyById(key.id, { includeUsage: true });
    expect(usageKey.usage.periods.daily.used).toBe(0);
    expect(usageKey.usage.periods.allTime.used).toBe(25);

    const allReset = await db.resetApiKeyUsage(key.id, "all");
    expect(allReset.deleted).toBe(1);
    usageKey = await db.getApiKeyById(key.id, { includeUsage: true });
    expect(usageKey.usage.periods.allTime.used).toBe(0);
  });

  it("enforces combined daily and weekly API key limits", async () => {
    const key = await db.createApiKey("dual", "machine-abc", {
      limitMode: "daily_weekly",
      dailyTokenLimit: 100,
      weeklyTokenLimit: 250,
    });

    await db.saveRequestUsage({
      provider: "openai",
      model: "gpt-4",
      apiKey: key.key,
      tokens: { prompt_tokens: 70, completion_tokens: 40 },
    });

    let access = await db.checkApiKeyAccess(key.key);
    expect(access.valid).toBe(false);
    expect(access.status).toBe("exhausted");
    expect(access.usage.limits.daily.used).toBe(110);
    expect(access.usage.limits.weekly.used).toBe(110);

    await db.resetApiKeyUsage(key.id, "daily");
    access = await db.checkApiKeyAccess(key.key);
    expect(access.valid).toBe(true);
    expect(access.usage.limits.daily.used).toBe(0);
    expect(access.usage.limits.weekly.used).toBe(0);
  });

  it("removes expired timed keys", async () => {
    const key = await db.createApiKey("timed", "machine-abc", {
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    expect(await db.validateApiKey(key.key)).toBe(false);
    expect(await db.getApiKeyById(key.id)).toBeNull();
  });

  it("preserves explicit expiry when creating keys through the API route", async () => {
    const { POST } = await import("@/app/api/keys/route.js");
    const expiresAt = "2099-01-01T00:00:00.000Z";

    const response = await POST(new Request("http://localhost/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "  route timed  ",
        expiresAt,
      }),
    }));

    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.name).toBe("route timed");
    expect(data.expiresAt).toBe(expiresAt);
    expect((await db.getApiKeyById(data.id)).expiresAt).toBe(expiresAt);
  });

  it("imports legacy exported API keys as unlimited", async () => {
    const createdAt = new Date().toISOString();

    await db.importDb({
      apiKeys: [{
        id: "legacy-key",
        key: "legacy-api-key",
        name: "legacy",
        machineId: "machine-abc",
        isActive: true,
        createdAt,
      }],
    });

    const key = await db.getApiKeyById("legacy-key", { includeUsage: true });
    expect(key).toMatchObject({
      limitMode: "unlimited",
      tokenLimit: null,
      dailyTokenLimit: null,
      weeklyTokenLimit: null,
      expiresAt: null,
      autoDeleteExpired: true,
      status: "active",
    });
    expect(await db.validateApiKey("legacy-api-key")).toBe(true);
  });

  it("roundtrips API key limits and usage history through export files", async () => {
    const key = await db.createApiKey("limited", "machine-abc", {
      limitMode: "hard",
      tokenLimit: 30,
      dailyTokenLimit: null,
      weeklyTokenLimit: null,
      expiresAt: "2099-01-01T00:00:00.000Z",
      autoDeleteExpired: false,
    });

    await db.saveRequestUsage({
      provider: "openai",
      model: "gpt-4",
      apiKey: key.key,
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const snapshot = await db.exportDb();

    await db.updateApiKey(key.id, { limitMode: "unlimited", tokenLimit: null });
    await db.saveRequestUsage({
      provider: "openai",
      model: "gpt-4",
      apiKey: key.key,
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
    });

    await db.importDb(snapshot);

    const restored = await db.getApiKeyById(key.id, { includeUsage: true });
    expect(restored).toMatchObject({
      limitMode: "hard",
      tokenLimit: 30,
      expiresAt: "2099-01-01T00:00:00.000Z",
      autoDeleteExpired: false,
    });
    expect(restored.usage.totalUsed).toBe(15);
    expect(restored.usage.remaining).toBe(15);
    expect(snapshot.usageHistory).toHaveLength(1);
  });

  it("keeps provider quota auto-disable metadata in export files", async () => {
    const connection = await db.createProviderConnection({
      provider: "claude",
      authType: "oauth",
      name: "quota account",
      quotaAutoDisabled: true,
      quotaAutoDisabledAt: "2026-01-01T00:00:00.000Z",
      quotaAutoDisabledUntil: "2026-01-02T00:00:00.000Z",
      quotaAutoDisabledReason: "quota_exhausted",
    });

    const snapshot = await db.exportDb();
    await db.updateProviderConnection(connection.id, {
      quotaAutoDisabled: false,
      quotaAutoDisabledAt: null,
      quotaAutoDisabledUntil: null,
      quotaAutoDisabledReason: null,
    });

    await db.importDb(snapshot);

    const restored = await db.getProviderConnectionById(connection.id);
    expect(restored).toMatchObject({
      quotaAutoDisabled: true,
      quotaAutoDisabledAt: "2026-01-01T00:00:00.000Z",
      quotaAutoDisabledUntil: "2026-01-02T00:00:00.000Z",
      quotaAutoDisabledReason: "quota_exhausted",
    });
  });
});
