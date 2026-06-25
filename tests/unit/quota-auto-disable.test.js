import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDbAdapterForTests } from "../../src/lib/db/driver.js";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let quota;

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-quota-auto-"));
  process.env.DATA_DIR = tempDir;
  resetDbAdapterForTests();
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  quota = await import("@/lib/quota/autoDisable.js");
  await db.initDb();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetDbAdapterForTests();
  vi.unstubAllGlobals();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

function createLocalStorageMock() {
  const items = new Map();
  return {
    getItem: vi.fn((key) => items.get(key) ?? null),
    setItem: vi.fn((key, value) => items.set(key, String(value))),
    removeItem: vi.fn((key) => items.delete(key)),
  };
}

describe("provider quota auto-disable", () => {
  it("disables exhausted accounts and stores reset metadata", async () => {
    const conn = await db.createProviderConnection({
      provider: "codex",
      authType: "oauth",
      email: "a@example.com",
      accessToken: "tok",
    });
    const resetAt = new Date(Date.now() + 60_000).toISOString();

    await quota.syncConnectionQuotaState(conn, {
      quotas: {
        daily: { used: 100, total: 100, resetAt },
      },
    });

    const updated = await db.getProviderConnectionById(conn.id);
    expect(updated.isActive).toBe(false);
    expect(updated.quotaAutoDisabled).toBe(true);
    expect(updated.quotaAutoDisabledUntil).toBe(resetAt);
    expect(updated.lastQuotaSnapshot.quotas[0]).toMatchObject({
      name: "daily",
      used: 100,
      total: 100,
      remainingPercentage: 0,
    });
  });

  it("restores only auto-disabled accounts after reset time passes", async () => {
    const auto = await db.createProviderConnection({
      provider: "codex",
      authType: "oauth",
      email: "auto@example.com",
      isActive: false,
    });
    await db.updateProviderConnection(auto.id, {
      quotaAutoDisabled: true,
      quotaAutoDisabledUntil: new Date(Date.now() - 1000).toISOString(),
    });

    const manual = await db.createProviderConnection({
      provider: "codex",
      authType: "oauth",
      email: "manual@example.com",
      isActive: false,
    });

    await quota.restoreExpiredAutoDisabledConnections("codex");

    expect((await db.getProviderConnectionById(auto.id)).isActive).toBe(true);
    expect((await db.getProviderConnectionById(manual.id)).isActive).toBe(false);
  });

  it("does not take ownership of manually disabled exhausted accounts", async () => {
    const conn = await db.createProviderConnection({
      provider: "codex",
      authType: "oauth",
      email: "manual-off@example.com",
      isActive: false,
    });

    await quota.syncConnectionQuotaState(conn, {
      quotas: {
        daily: {
          used: 100,
          total: 100,
          resetAt: new Date(Date.now() + 60_000).toISOString(),
        },
      },
    });

    const updated = await db.getProviderConnectionById(conn.id);
    expect(updated.isActive).toBe(false);
    expect(updated.quotaAutoDisabled).toBeUndefined();
  });

  it("updates reset metadata for already auto-disabled exhausted accounts", async () => {
    const conn = await db.createProviderConnection({
      provider: "codex",
      authType: "oauth",
      email: "auto-refresh@example.com",
      isActive: false,
    });
    await db.updateProviderConnection(conn.id, {
      quotaAutoDisabled: true,
      quotaAutoDisabledUntil: new Date(Date.now() + 60_000).toISOString(),
      quotaAutoDisabledReason: "daily",
    });
    const updatedResetAt = new Date(Date.now() + 120_000).toISOString();

    await quota.syncConnectionQuotaState(await db.getProviderConnectionById(conn.id), {
      quotas: {
        weekly: { used: 200, total: 200, resetAt: updatedResetAt },
      },
    });

    const updated = await db.getProviderConnectionById(conn.id);
    expect(updated.isActive).toBe(false);
    expect(updated.quotaAutoDisabled).toBe(true);
    expect(updated.quotaAutoDisabledUntil).toBe(updatedResetAt);
    expect(updated.quotaAutoDisabledReason).toBe("weekly");
  });

  it("does nothing when auto toggle is disabled", async () => {
    await db.updateSettings({ quotaAutoToggleEnabled: false });
    const conn = await db.createProviderConnection({
      provider: "codex",
      authType: "oauth",
      email: "off@example.com",
      accessToken: "tok",
    });

    await quota.syncConnectionQuotaState(conn, {
      quotas: {
        daily: { used: 100, total: 100, resetAt: new Date(Date.now() + 60_000).toISOString() },
      },
    });

    const updated = await db.getProviderConnectionById(conn.id);
    expect(updated.isActive).toBe(true);
    expect(updated.quotaAutoDisabled).toBeUndefined();
  });

  it("calculates average quota by provider service", async () => {
    const { buildProviderQuotaAverages } = await import("@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js");
    const connections = [
      { id: "codex-a", provider: "codex", isActive: true },
      { id: "codex-b", provider: "codex", isActive: false },
      { id: "codex-c", provider: "codex", isActive: false },
      { id: "claude-a", provider: "claude", isActive: true },
    ];

    const averages = buildProviderQuotaAverages(connections, {
      "codex-a": {
        quotas: [
          { used: 20, total: 100 },
          { used: 40, total: 100 },
        ],
      },
      "codex-b": {
        quotas: [{ used: 100, total: 100 }],
      },
    });

    expect(averages.find((avg) => avg.provider === "codex")).toMatchObject({
      accountCount: 3,
      activeCount: 1,
      measuredAccounts: 2,
      averageRemaining: 35,
      exhaustedCount: 1,
    });
    expect(averages.find((avg) => avg.provider === "claude")).toMatchObject({
      accountCount: 1,
      activeCount: 1,
      measuredAccounts: 0,
      averageRemaining: null,
    });
  });

  it("uses session quota rows for provider service averages", async () => {
    const { buildProviderQuotaAverages } = await import("@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js");
    const averages = buildProviderQuotaAverages(
      [{ id: "codex-a", provider: "codex", isActive: true }],
      {
        "codex-a": {
          quotas: [
            { name: "session", used: 25, total: 100 },
            { name: "weekly", used: 90, total: 100 },
          ],
        },
      },
    );

    expect(averages.find((avg) => avg.provider === "codex")).toMatchObject({
      measuredAccounts: 1,
      averageRemaining: 75,
    });
  });

  it("waits for all quota fetches before averaging a provider", async () => {
    const { buildProviderQuotaAverages } = await import("@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js");
    const connections = [
      { id: "codex-a", provider: "codex", isActive: true },
      { id: "codex-b", provider: "codex", isActive: true },
    ];
    const quotaData = {
      "codex-a": {
        quotas: [{ name: "session", used: 20, total: 100 }],
      },
      "codex-b": {
        quotas: [{ name: "session", used: 60, total: 100 }],
      },
    };

    const loadingAverage = buildProviderQuotaAverages(connections, quotaData, {
      loadingById: { "codex-b": true },
      completedById: { "codex-a": true, "codex-b": false },
    }).find((avg) => avg.provider === "codex");

    expect(loadingAverage).toMatchObject({
      isLoading: true,
      pendingCount: 1,
      averageRemaining: null,
    });

    const readyAverage = buildProviderQuotaAverages(connections, quotaData, {
      loadingById: { "codex-a": false, "codex-b": false },
      completedById: { "codex-a": true, "codex-b": true },
    }).find((avg) => avg.provider === "codex");

    expect(readyAverage).toMatchObject({
      isLoading: false,
      pendingCount: 0,
      averageRemaining: 60,
    });
  });

  it("reuses fresh provider quota cache without a usage API call", async () => {
    vi.resetModules();
    const localStorage = createLocalStorageMock();
    const fetchMock = vi.fn();
    vi.stubGlobal("window", { localStorage });
    vi.stubGlobal("fetch", fetchMock);

    const quotaCache = await import("@/app/(dashboard)/dashboard/usage/components/ProviderLimits/quotaCache.js");
    quotaCache.mergeQuotaCacheEntries({
      "codex-cache": {
        quotas: [{ name: "session", used: 10, total: 100 }],
        plan: "pro",
        message: null,
      },
    });

    const result = await quotaCache.fetchQuotaWithCache({
      id: "codex-cache",
      provider: "codex",
    });

    expect(result.fromCache).toBe(true);
    expect(result.entry.quotas[0].total).toBe(100);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("routes to the account with the highest cached quota", async () => {
    await db.updateSettings({ fallbackStrategy: "highest" });
    const low = await db.createProviderConnection({
      provider: "codex",
      authType: "oauth",
      email: "low@example.com",
      accessToken: "low-token",
      priority: 1,
    });
    const high = await db.createProviderConnection({
      provider: "codex",
      authType: "oauth",
      email: "high@example.com",
      accessToken: "high-token",
      priority: 2,
    });

    await db.updateProviderConnection(low.id, {
      lastQuotaSnapshot: {
        quotas: [{ name: "session", used: 80, total: 100 }],
        savedAt: new Date().toISOString(),
      },
    });
    await db.updateProviderConnection(high.id, {
      lastQuotaSnapshot: {
        quotas: [{ name: "session", used: 10, total: 100 }],
        savedAt: new Date().toISOString(),
      },
    });

    const { getProviderCredentials } = await import("@/sse/services/auth.js");
    const credentials = await getProviderCredentials("codex");

    expect(credentials.connectionId).toBe(high.id);
    expect(credentials.accessToken).toBe("high-token");
  });

  it("keeps legacy highest-session-quota routing compatible", async () => {
    await db.updateSettings({ fallbackStrategy: "highest-session-quota" });
    const low = await db.createProviderConnection({
      provider: "codex",
      authType: "oauth",
      email: "legacy-low@example.com",
      accessToken: "legacy-low-token",
      priority: 1,
    });
    const high = await db.createProviderConnection({
      provider: "codex",
      authType: "oauth",
      email: "legacy-high@example.com",
      accessToken: "legacy-high-token",
      priority: 2,
    });

    await db.updateProviderConnection(low.id, {
      lastQuotaSnapshot: {
        quotas: [{ name: "session", used: 90, total: 100 }],
        savedAt: new Date().toISOString(),
      },
    });
    await db.updateProviderConnection(high.id, {
      lastQuotaSnapshot: {
        quotas: [{ name: "session", used: 30, total: 100 }],
        savedAt: new Date().toISOString(),
      },
    });

    const { getProviderCredentials } = await import("@/sse/services/auth.js");
    const credentials = await getProviderCredentials("codex");

    expect(credentials.connectionId).toBe(high.id);
    expect(credentials.accessToken).toBe("legacy-high-token");
  });

  it("routes to the account with the lowest cached quota", async () => {
    await db.updateSettings({ fallbackStrategy: "lowest" });
    const low = await db.createProviderConnection({
      provider: "codex",
      authType: "oauth",
      email: "lowest-low@example.com",
      accessToken: "lowest-low-token",
      priority: 1,
    });
    const high = await db.createProviderConnection({
      provider: "codex",
      authType: "oauth",
      email: "lowest-high@example.com",
      accessToken: "lowest-high-token",
      priority: 2,
    });

    await db.updateProviderConnection(low.id, {
      lastQuotaSnapshot: {
        quotas: [{ name: "session", used: 80, total: 100 }],
        savedAt: new Date().toISOString(),
      },
    });
    await db.updateProviderConnection(high.id, {
      lastQuotaSnapshot: {
        quotas: [{ name: "session", used: 10, total: 100 }],
        savedAt: new Date().toISOString(),
      },
    });

    const { getProviderCredentials } = await import("@/sse/services/auth.js");
    const credentials = await getProviderCredentials("codex");

    expect(credentials.connectionId).toBe(low.id);
    expect(credentials.accessToken).toBe("lowest-low-token");
  });

  it("routes default mode one by one in provider order", async () => {
    await db.updateSettings({ fallbackStrategy: "default" });
    const first = await db.createProviderConnection({
      provider: "codex",
      authType: "oauth",
      email: "default-1@example.com",
      accessToken: "default-token-1",
      priority: 1,
    });
    const second = await db.createProviderConnection({
      provider: "codex",
      authType: "oauth",
      email: "default-2@example.com",
      accessToken: "default-token-2",
      priority: 2,
    });
    const third = await db.createProviderConnection({
      provider: "codex",
      authType: "oauth",
      email: "default-3@example.com",
      accessToken: "default-token-3",
      priority: 3,
    });

    const { getProviderCredentials } = await import("@/sse/services/auth.js");

    expect((await getProviderCredentials("codex")).connectionId).toBe(first.id);
    expect((await getProviderCredentials("codex")).connectionId).toBe(second.id);
    expect((await getProviderCredentials("codex")).connectionId).toBe(third.id);
    expect((await getProviderCredentials("codex")).connectionId).toBe(first.id);
  });

  it("routes random mode to a random available account", async () => {
    await db.updateSettings({ fallbackStrategy: "random" });
    await db.createProviderConnection({
      provider: "codex",
      authType: "oauth",
      email: "random-1@example.com",
      accessToken: "random-token-1",
      priority: 1,
    });
    const second = await db.createProviderConnection({
      provider: "codex",
      authType: "oauth",
      email: "random-2@example.com",
      accessToken: "random-token-2",
      priority: 2,
    });
    await db.createProviderConnection({
      provider: "codex",
      authType: "oauth",
      email: "random-3@example.com",
      accessToken: "random-token-3",
      priority: 3,
    });
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    const { getProviderCredentials } = await import("@/sse/services/auth.js");
    const credentials = await getProviderCredentials("codex");

    expect(credentials.connectionId).toBe(second.id);
    expect(credentials.accessToken).toBe("random-token-2");
  });
});
