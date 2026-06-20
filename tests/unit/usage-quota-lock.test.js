import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the DB layer so we can assert what the helper persists.
vi.mock("@/lib/localDb", () => ({
  updateProviderConnection: vi.fn(),
}));

import {
  getQuotaResetUntil, buildModelLockUpdate, getEarliestModelLockUntil,
} from "../../open-sse/services/accountFallback.js";
import { updateProviderConnection } from "@/lib/localDb";
import {
  persistQuotaSnapshot, applyQuotaLockIfNeeded, getUnavailableUntil,
} from "../../src/lib/usage/quotaPersist.js";

const noopLog = { warn: () => {}, info: () => {}, debug: () => {} };

describe("quota-lock apply path (engine-level)", () => {
  it("fully depleted kiro produces a lock update", () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    const conn = { provider: "kiro", quotaInfos: [{ used: 100, total: 100, resetAt: future }] };
    const resetUntil = getQuotaResetUntil(conn);
    expect(resetUntil).toBeTruthy();
    const lockUpdate = buildModelLockUpdate(null, new Date(resetUntil).getTime() - Date.now());
    expect(Object.values(lockUpdate).filter(v => typeof v === "string").length).toBeGreaterThan(0);
  });

  it("partially-used account not locked", () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    const conn = { provider: "kiro", quotaInfos: [{ used: 50, total: 100, resetAt: future }] };
    expect(getQuotaResetUntil(conn)).toBeNull();
  });

  it("getEarliestModelLockUntil surfaces the lock after apply", () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    const conn = { provider: "kiro", quotaInfos: [{ used: 100, total: 100, resetAt: future }] };
    const resetUntil = getQuotaResetUntil(conn);
    const lockUpdate = buildModelLockUpdate(null, new Date(resetUntil).getTime() - Date.now());
    const updatedConn = { ...conn, ...lockUpdate };
    const earliest = getEarliestModelLockUntil(updatedConn);
    expect(earliest).toBeTruthy();
  });

  it("providers outside QUOTA_DEPLETION_PROVIDERS never locked", () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    expect(getQuotaResetUntil({ provider: "openai", quotaInfos: [{ used: 100, total: 100, resetAt: future }] })).toBeNull();
  });
});

describe("quotaPersist helpers (F-1 regression coverage)", () => {
  beforeEach(() => {
    updateProviderConnection.mockReset();
    updateProviderConnection.mockResolvedValue(undefined);
  });

  it("persistQuotaSnapshot normalizes the raw usage.quotas object map to an array", async () => {
    const conn = { id: "c1", provider: "kiro" };
    const usage = {
      plan: "pro",
      quotas: {
        session: { used: 100, total: 100, resetAt: new Date(Date.now() + 3600_000).toISOString() },
        weekly: { used: 50, total: 100, resetAt: new Date(Date.now() + 7200_000).toISOString() },
      },
    };
    const result = await persistQuotaSnapshot(conn, usage);
    // updateProviderConnection was called with quotaInfos as an ARRAY, not the raw object
    expect(updateProviderConnection).toHaveBeenCalledTimes(1);
    const update = updateProviderConnection.mock.calls[0][1];
    expect(Array.isArray(update.quotaInfos)).toBe(true);
    expect(update.quotaInfos.length).toBe(2);
    // quotaPlan / quotaMessage / quotaUpdatedAt persisted
    expect(update.quotaPlan).toBe("pro");
    expect(update.quotaMessage).toBeNull();
    expect(typeof update.quotaUpdatedAt).toBe("string");
    // Returns the connection with normalized array
    expect(Array.isArray(result.quotaInfos)).toBe(true);
  });

  it("persistQuotaSnapshot skips quotaInfos when usage has none (preserves last good snapshot)", async () => {
    const conn = { id: "c1", provider: "kiro" };
    const usage = { plan: null, message: "Auth expired" }; // no quotas field
    await persistQuotaSnapshot(conn, usage);
    const update = updateProviderConnection.mock.calls[0][1];
    expect(update.quotaInfos).toBeUndefined(); // not overwritten
    expect(update.quotaMessage).toBe("Auth expired");
  });

  it("applyQuotaLockIfNeeded applies lock when fully depleted with future reset", async () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    const conn = { id: "c2", provider: "kiro" };
    const usage = {
      quotas: {
        session: { used: 100, total: 100, resetAt: future },
      },
    };
    await applyQuotaLockIfNeeded(conn, usage);
    // buildModelLockUpdate writes a modelLock___all field; assert one was persisted
    expect(updateProviderConnection).toHaveBeenCalledTimes(1);
    const update = updateProviderConnection.mock.calls[0][1];
    const lockValues = Object.values(update).filter(v => typeof v === "string");
    expect(lockValues.length).toBeGreaterThan(0);
    expect(new Date(lockValues[0]).getTime()).toBeGreaterThan(Date.now());
  });

  it("applyQuotaLockIfNeeded is a no-op when not depleted", async () => {
    const conn = { id: "c3", provider: "kiro" };
    const usage = { quotas: { session: { used: 50, total: 100, resetAt: new Date(Date.now() + 3600_000).toISOString() } } };
    await applyQuotaLockIfNeeded(conn, usage);
    expect(updateProviderConnection).not.toHaveBeenCalled();
  });

  it("applyQuotaLockIfNeeded is a no-op for providers outside QUOTA_DEPLETION_PROVIDERS", async () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    const conn = { id: "c4", provider: "openai" };
    const usage = { quotas: { session: { used: 100, total: 100, resetAt: future } } };
    await applyQuotaLockIfNeeded(conn, usage);
    expect(updateProviderConnection).not.toHaveBeenCalled();
  });
});
