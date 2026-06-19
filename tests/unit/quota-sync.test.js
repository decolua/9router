// Unit tests for A5 #1901: quota-depletion account-level lock.
import { describe, it, expect } from "vitest";
import {
  getQuotaResetUntil,
  buildModelLockUpdate,
  getModelLockKey,
  MODEL_LOCK_ALL,
  QUOTA_DEPLETION_PROVIDERS,
} from "../../open-sse/services/accountFallback.js";

describe("A5: quota depletion → account lock (#1901)", () => {
  it("QUOTA_DEPLETION_PROVIDERS covers kiro/qoder/antigravity/codex", () => {
    expect(QUOTA_DEPLETION_PROVIDERS.has("kiro")).toBe(true);
    expect(QUOTA_DEPLETION_PROVIDERS.has("qoder")).toBe(true);
    expect(QUOTA_DEPLETION_PROVIDERS.has("antigravity")).toBe(true);
    expect(QUOTA_DEPLETION_PROVIDERS.has("codex")).toBe(true);
  });

  it("returns reset timestamp when every bucket is depleted with future resetAt", () => {
    const future = new Date(Date.now() + 3600 * 1000).toISOString();
    const conn = {
      provider: "kiro",
      quotaInfos: [
        { used: 100, total: 100, resetAt: future },
        { used: 50, total: 50, resetAt: future },
      ],
    };
    const resetUntil = getQuotaResetUntil(conn);
    expect(resetUntil).toBeTruthy();
    expect(new Date(resetUntil).getTime()).toBeGreaterThan(Date.now());
  });

  it("returns null when any bucket still has room", () => {
    const future = new Date(Date.now() + 3600 * 1000).toISOString();
    const conn = {
      provider: "kiro",
      quotaInfos: [
        { used: 100, total: 100, resetAt: future },
        { used: 5, total: 50, resetAt: future },
      ],
    };
    expect(getQuotaResetUntil(conn)).toBeNull();
  });

  it("returns null for providers outside the gate", () => {
    const future = new Date(Date.now() + 3600 * 1000).toISOString();
    const conn = {
      provider: "openai",
      quotaInfos: [{ used: 100, total: 100, resetAt: future }],
    };
    expect(getQuotaResetUntil(conn)).toBeNull();
  });

  it("buildModelLockUpdate(null, ms) sets the MODEL_LOCK_ALL key", () => {
    const update = buildModelLockUpdate(null, 60_000);
    const key = getModelLockKey(null);
    expect(key).toBe(MODEL_LOCK_ALL);
    expect(update[key]).toBeTruthy();
    expect(new Date(update[key]).getTime()).toBeGreaterThan(Date.now());
  });

  it("returns null when resetAt has already passed", () => {
    const past = new Date(Date.now() - 3600 * 1000).toISOString();
    const conn = {
      provider: "kiro",
      quotaInfos: [{ used: 100, total: 100, resetAt: past }],
    };
    expect(getQuotaResetUntil(conn)).toBeNull();
  });
});
