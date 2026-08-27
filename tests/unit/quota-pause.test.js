import { describe, it, expect, vi, beforeEach } from "vitest";

// Pure shared helpers — no server imports, safe to unit test directly.
import {
  normalizeThreshold,
  isQuotaEligible,
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
  quotaPauseThreshold: 15,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  // quotaGuard keeps an in-memory cache; clear it between cases.
  _clearQuotaCache();
});

describe("normalizeThreshold", () => {
  it("returns 0 when disabled / invalid", () => {
    expect(normalizeThreshold({})).toBe(0);
    expect(normalizeThreshold({ quotaPauseThreshold: 0 })).toBe(0);
    expect(normalizeThreshold({ quotaPauseThreshold: -5 })).toBe(0);
    expect(normalizeThreshold({ quotaPauseThreshold: 150 })).toBe(0);
    expect(normalizeThreshold({ quotaPauseThreshold: "abc" })).toBe(0);
  });
  it("clamps to 1..100", () => {
    expect(normalizeThreshold({ quotaPauseThreshold: 15 })).toBe(15);
    expect(normalizeThreshold({ quotaPauseThreshold: 100 })).toBe(100);
  });
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

describe("isQuotaPaused", () => {
  it("disabled when no threshold", () => {
    expect(isQuotaPaused({ quotaPauseThreshold: 0, lastQuotaSnapshot: { remainingPercentage: 2 } })).toBe(false);
  });
  it("pauses when remaining <= threshold (boundary inclusive)", () => {
    expect(isQuotaPaused(okConn({ lastQuotaSnapshot: { remainingPercentage: 10 } }))).toBe(true);
    expect(isQuotaPaused(okConn({ lastQuotaSnapshot: { remainingPercentage: 15 } }))).toBe(true);
    expect(isQuotaPaused(okConn({ lastQuotaSnapshot: { remainingPercentage: 16 } }))).toBe(false);
  });
  it("never pauses when unlimited", () => {
    expect(isQuotaPaused(okConn({ lastQuotaSnapshot: { remainingPercentage: 0, unlimited: true } }))).toBe(false);
  });
  it("never pauses without a snapshot", () => {
    expect(isQuotaPaused(okConn({}))).toBe(false);
  });
  it("never pauses ineligible providers (fail-open)", () => {
    expect(isQuotaPaused({ authType: "cookie", provider: "claude", quotaPauseThreshold: 15, lastQuotaSnapshot: { remainingPercentage: 1 } })).toBe(false);
  });
  it("auto-recovers once remaining climbs above threshold (post reset)", () => {
    const paused = okConn({ lastQuotaSnapshot: { remainingPercentage: 5 } });
    expect(isQuotaPaused(paused)).toBe(true);
    const recovered = { ...paused, lastQuotaSnapshot: { remainingPercentage: 40 } };
    expect(isQuotaPaused(recovered)).toBe(false);
  });
});

describe("getQuotaPauseInfo", () => {
  it("reports disabled state", () => {
    const info = getQuotaPauseInfo({ quotaPauseThreshold: 0 });
    expect(info.enabled).toBe(false);
    expect(info.paused).toBe(false);
  });
  it("reports paused + remaining + threshold", () => {
    const info = getQuotaPauseInfo(okConn({ lastQuotaSnapshot: { remainingPercentage: 8 } }));
    expect(info.enabled).toBe(true);
    expect(info.paused).toBe(true);
    expect(info.threshold).toBe(15);
    expect(info.remainingPercentage).toBe(8);
  });
});

describe("deriveQuotaSnapshot (raw usage → gating snapshot)", () => {
  it("returns null when there is no usable quota data", () => {
    expect(deriveQuotaSnapshot("claude", null)).toBeNull();
    expect(deriveQuotaSnapshot("claude", { message: "auth expired" })).toBeNull();
    expect(deriveQuotaSnapshot("claude", {})).toBeNull();
    expect(deriveQuotaSnapshot("claude", { quotas: {} })).toBeNull();
  });

  it("takes the most-depleted window (min remaining) across quotas", () => {
    const snap = deriveQuotaSnapshot("claude", {
      quotas: {
        "session (5h)": { used: 90, total: 100, remainingPercentage: 10 },
        "weekly (7d)": { used: 50, total: 100, remainingPercentage: 50 },
      },
    });
    expect(snap.remainingPercentage).toBe(10);
    expect(snap.unlimited).toBe(false);
  });

  it("falls back to used/total when remainingPercentage is absent", () => {
    const snap = deriveQuotaSnapshot("codex", {
      quotas: { "5h": { used: 95, total: 100 } },
    });
    expect(snap.remainingPercentage).toBe(5);
  });

  it("treats all-unlimited windows as unlimited (never pause)", () => {
    const snap = deriveQuotaSnapshot("glm", {
      quotas: { a: { unlimited: true }, b: { unlimited: true } },
    });
    expect(snap.unlimited).toBe(true);
    expect(snap.remainingPercentage).toBe(100);
  });

  it("captures the earliest reset time across windows", () => {
    const snap = deriveQuotaSnapshot("claude", {
      quotas: {
        "session (5h)": { used: 90, total: 100, remainingPercentage: 10, resetAt: "2026-08-27T12:00:00Z" },
        "weekly (7d)": { used: 50, total: 100, remainingPercentage: 50, resetAt: "2026-09-01T00:00:00Z" },
      },
    });
    expect(snap.resetAt).toBe("2026-08-27T12:00:00.000Z");
  });
});

describe("evaluateQuota (routing engine)", () => {
  it("returns disabled when threshold unset", async () => {
    const r = await evaluateQuota({ id: "x", authType: "oauth", provider: "claude" });
    expect(r.paused).toBe(false);
    expect(r.reason).toBe("disabled");
  });

  it("uses a fresh persisted snapshot without a live fetch", async () => {
    const conn = okConn({ lastQuotaSnapshot: { remainingPercentage: 5, fetchedAt: new Date().toISOString() } });
    const r = await evaluateQuota(conn);
    expect(r.paused).toBe(true);
    expect(getUsageForProvider).not.toHaveBeenCalled();
  });

  it("live-fetches on a cache miss, then pauses and persists the snapshot", async () => {
    vi.mocked(getUsageForProvider).mockResolvedValue({
      quotas: { "session (5h)": { used: 90, total: 100, remainingPercentage: 10 } },
    });
    const conn = okConn(); // no snapshot
    const r = await evaluateQuota(conn);
    expect(r.paused).toBe(true);
    expect(getUsageForProvider).toHaveBeenCalledTimes(1);
    expect(updateProviderConnection).toHaveBeenCalledWith("c1", expect.objectContaining({ lastQuotaSnapshot: expect.objectContaining({ remainingPercentage: 10 }) }));
  });

  it("fail-open: live fetch error never pauses", async () => {
    vi.mocked(getUsageForProvider).mockRejectedValue(new Error("network down"));
    const r = await evaluateQuota(okConn());
    expect(r.paused).toBe(false);
    expect(r.reason).toBe("no-data");
  });

  it("uses the in-memory cache on a subsequent call (no second fetch)", async () => {
    vi.mocked(getUsageForProvider).mockResolvedValue({
      quotas: { "session (5h)": { used: 88, total: 100, remainingPercentage: 12 } },
    });
    await evaluateQuota(okConn());
    await evaluateQuota(okConn());
    expect(getUsageForProvider).toHaveBeenCalledTimes(1);
  });
});
