import { describe, it, expect, vi, beforeEach } from "vitest";

// Pure shared helpers — no server imports, safe to unit test directly.
import {
  isQuotaEligible,
  getWindowThresholds,
  getPausedWindow,
  isQuotaPaused,
  getQuotaPauseInfo,
  deriveQuotaSnapshot,
} from "@/shared/utils/quotaPause.js";

import { USAGE_APIKEY_PROVIDERS } from "@/shared/constants/providers";

// Routing engine — mock its server-side imports (usage fetch + DB writes).
vi.mock("open-sse/services/usage.js", () => ({
  getUsageForProvider: vi.fn(),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/lib/localDb", () => ({
  updateProviderConnection: vi.fn().mockResolvedValue(undefined),
}));

import { evaluateQuota, _clearQuotaCache } from "@/sse/services/quotaGuard.js";
import { getUsageForProvider } from "open-sse/services/usage.js";
import { updateProviderConnection } from "@/lib/localDb";

const okConn = (over = {}) => ({
  id: "c1",
  provider: "claude",
  authType: "oauth",
  quotaPauseThresholds: {},
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  _clearQuotaCache();
});

describe("isQuotaEligible", () => {
  it("oauth is always eligible", () => {
    expect(isQuotaEligible({ authType: "oauth", provider: "claude" })).toBe(true);
  });
  it("apikey only eligible when provider supports usage", () => {
    const p = USAGE_APIKEY_PROVIDERS[0];
    expect(isQuotaEligible({ authType: "apikey", provider: p })).toBe(true);
    expect(isQuotaEligible({ authType: "apikey", provider: "definitely-not-a-usage-provider" })).toBe(false);
  });
  it("cookie is never eligible", () => {
    expect(isQuotaEligible({ authType: "cookie", provider: "claude" })).toBe(false);
  });
});

describe("isQuotaPaused / getPausedWindow (per-window)", () => {
  const windows = [
    { key: "session (5h)", remainingPercentage: 10, resetAt: null, unlimited: false },
    { key: "weekly (7d)", remainingPercentage: 50, resetAt: null, unlimited: false },
  ];

  it("disabled when no thresholds set", () => {
    expect(isQuotaPaused(okConn({ lastQuotaSnapshot: { windows } }))).toBe(false);
  });
  it("pauses when a configured window is below its threshold (boundary inclusive)", () => {
    expect(isQuotaPaused(okConn({ quotaPauseThresholds: { "session (5h)": 15 }, lastQuotaSnapshot: { windows } }))).toBe(true);
    expect(isQuotaPaused(okConn({ quotaPauseThresholds: { "session (5h)": 10 }, lastQuotaSnapshot: { windows } }))).toBe(true);
    expect(isQuotaPaused(okConn({ quotaPauseThresholds: { "session (5h)": 15 }, lastQuotaSnapshot: { windows: [{ key: "session (5h)", remainingPercentage: 16, resetAt: null, unlimited: false }] } }))).toBe(false);
  });
  it("does not pause for a window with no threshold even if low", () => {
    expect(isQuotaPaused(okConn({ quotaPauseThresholds: { "weekly (7d)": 15 }, lastQuotaSnapshot: { windows } }))).toBe(false);
  });
  it("never pauses an unlimited window even if threshold set", () => {
    const w = [{ key: "session (5h)", remainingPercentage: 0, resetAt: null, unlimited: true }];
    expect(isQuotaPaused(okConn({ quotaPauseThresholds: { "session (5h)": 15 }, lastQuotaSnapshot: { windows: w } }))).toBe(false);
  });
  it("never pauses ineligible providers (fail-open)", () => {
    expect(isQuotaPaused({ authType: "cookie", provider: "claude", quotaPauseThresholds: { "session (5h)": 15 }, lastQuotaSnapshot: { windows } })).toBe(false);
  });
  it("auto-recovers once the offending window rebounds", () => {
    const paused = okConn({ quotaPauseThresholds: { "session (5h)": 15 }, lastQuotaSnapshot: { windows } });
    expect(isQuotaPaused(paused)).toBe(true);
    const recovered = { ...paused, lastQuotaSnapshot: { windows: [{ key: "session (5h)", remainingPercentage: 40, resetAt: null, unlimited: false }, windows[1]] } };
    expect(isQuotaPaused(recovered)).toBe(false);
  });
  it("getPausedWindow returns the triggering window key", () => {
    const triggered = getPausedWindow(okConn({ quotaPauseThresholds: { "session (5h)": 15 }, lastQuotaSnapshot: { windows } }));
    expect(triggered?.key).toBe("session (5h)");
  });
});

describe("getQuotaPauseInfo", () => {
  it("reports disabled state", () => {
    const info = getQuotaPauseInfo(okConn());
    expect(info.enabled).toBe(false);
    expect(info.paused).toBe(false);
    expect(info.windows).toEqual([]);
  });
  it("reports per-window config + paused state", () => {
    const info = getQuotaPauseInfo(okConn({
      quotaPauseThresholds: { "session (5h)": 15 },
      lastQuotaSnapshot: { windows: [{ key: "session (5h)", remainingPercentage: 8, resetAt: null, unlimited: false }] },
    }));
    expect(info.enabled).toBe(true);
    expect(info.paused).toBe(true);
    expect(info.triggered?.key).toBe("session (5h)");
    expect(info.windows[0]).toMatchObject({ key: "session (5h)", threshold: 15, paused: true, remainingPercentage: 8 });
  });
});

describe("deriveQuotaSnapshot (raw usage → per-window snapshot)", () => {
  it("returns null when there is no usable quota data", () => {
    expect(deriveQuotaSnapshot("claude", null)).toBeNull();
    expect(deriveQuotaSnapshot("claude", { message: "auth expired" })).toBeNull();
    expect(deriveQuotaSnapshot("claude", {})).toBeNull();
    expect(deriveQuotaSnapshot("claude", { quotas: {} })).toBeNull();
  });

  it("captures each window key with its remaining % (min not collapsed)", () => {
    const snap = deriveQuotaSnapshot("claude", {
      quotas: {
        "session (5h)": { used: 90, total: 100, remainingPercentage: 10 },
        "weekly (7d)": { used: 50, total: 100, remainingPercentage: 50 },
      },
    });
    expect(snap.windows).toHaveLength(2);
    const byKey = Object.fromEntries(snap.windows.map((w) => [w.key, w.remainingPercentage]));
    expect(byKey["session (5h)"]).toBe(10);
    expect(byKey["weekly (7d)"]).toBe(50);
  });

  it("falls back to used/total when remainingPercentage is absent (codex)", () => {
    const snap = deriveQuotaSnapshot("codex", {
      quotas: { session: { used: 95, total: 100, remaining: 5, resetAt: null } },
    });
    expect(snap.windows[0].remainingPercentage).toBe(5);
  });

  it("marks unlimited windows", () => {
    const snap = deriveQuotaSnapshot("glm", {
      quotas: { a: { unlimited: true, remainingPercentage: 100 } },
    });
    expect(snap.windows[0].unlimited).toBe(true);
  });

  it("captures per-window resetAt", () => {
    const snap = deriveQuotaSnapshot("claude", {
      quotas: { "session (5h)": { used: 90, total: 100, remainingPercentage: 10, resetAt: "2026-08-27T12:00:00Z" } },
    });
    expect(snap.windows[0].resetAt).toBe("2026-08-27T12:00:00.000Z");
  });
});

describe("evaluateQuota (routing engine)", () => {
  it("returns disabled when no window thresholds set", async () => {
    const r = await evaluateQuota(okConn({ lastQuotaSnapshot: { windows: [{ key: "session (5h)", remainingPercentage: 2 }] } }));
    expect(r.paused).toBe(false);
    expect(r.reason).toBe("disabled");
  });

  it("uses a fresh persisted snapshot without a live fetch", async () => {
    const conn = okConn({
      quotaPauseThresholds: { "session (5h)": 15 },
      lastQuotaSnapshot: { windows: [{ key: "session (5h)", remainingPercentage: 5, resetAt: null, unlimited: false }], fetchedAt: new Date().toISOString() },
    });
    const r = await evaluateQuota(conn);
    expect(r.paused).toBe(true);
    expect(getUsageForProvider).not.toHaveBeenCalled();
  });

  it("live-fetches on a cache miss, then pauses and persists the per-window snapshot", async () => {
    vi.mocked(getUsageForProvider).mockResolvedValue({
      quotas: { "session (5h)": { used: 90, total: 100, remainingPercentage: 10 } },
    });
    const conn = okConn({ quotaPauseThresholds: { "session (5h)": 15 } });
    const r = await evaluateQuota(conn);
    expect(r.paused).toBe(true);
    expect(getUsageForProvider).toHaveBeenCalledTimes(1);
    expect(updateProviderConnection).toHaveBeenCalledWith("c1", expect.objectContaining({
      lastQuotaSnapshot: expect.objectContaining({ windows: expect.arrayContaining([expect.objectContaining({ key: "session (5h)", remainingPercentage: 10 })]) }),
    }));
  });

  it("does not pause when only an unconfigured window is low", async () => {
    vi.mocked(getUsageForProvider).mockResolvedValue({
      quotas: { "session (5h)": { used: 95, total: 100, remainingPercentage: 5 } },
    });
    const r = await evaluateQuota(okConn({ quotaPauseThresholds: { "weekly (7d)": 15 } }));
    expect(r.paused).toBe(false);
  });

  it("fail-open: live fetch error never pauses", async () => {
    vi.mocked(getUsageForProvider).mockRejectedValue(new Error("network down"));
    const r = await evaluateQuota(okConn({ quotaPauseThresholds: { "session (5h)": 15 } }));
    expect(r.paused).toBe(false);
    expect(r.reason).toBe("no-data");
  });

  it("uses the in-memory cache on a subsequent call (no second fetch)", async () => {
    vi.mocked(getUsageForProvider).mockResolvedValue({
      quotas: { "session (5h)": { used: 88, total: 100, remainingPercentage: 12 } },
    });
    await evaluateQuota(okConn({ quotaPauseThresholds: { "session (5h)": 15 } }));
    await evaluateQuota(okConn({ quotaPauseThresholds: { "session (5h)": 15 } }));
    expect(getUsageForProvider).toHaveBeenCalledTimes(1);
  });
});
