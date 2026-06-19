import { describe, it, expect } from "vitest";
import {
  getQuotaResetUntil, buildModelLockUpdate, getEarliestModelLockUntil,
} from "../../open-sse/services/accountFallback.js";

describe("quota-lock apply path", () => {
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
