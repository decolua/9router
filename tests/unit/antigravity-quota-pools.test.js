import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  getAntigravityUsage: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getSettings: mocks.getSettings,
  getProxyPools: vi.fn(),
  validateApiKey: vi.fn(),
  updateProviderConnection: vi.fn(),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
  pickProxyPoolId: vi.fn(),
}));
vi.mock("@/shared/constants/providers.js", () => ({
  FREE_PROVIDERS: {},
  resolveProviderId: (provider) => provider,
}));
vi.mock("open-sse/services/usage/google.js", () => ({
  getAntigravityUsage: mocks.getAntigravityUsage,
}));
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }));

const {
  getAntigravityQuotaCache,
  handleAntigravityQuotaError,
  refreshAntigravityQuota,
  isAntigravityPoolBlocked,
} = await import("@/sse/services/antigravityQuota.js");
const { getProviderCredentials } = await import("@/sse/services/auth.js");
const {
  getAntigravityQuotaPool,
  getPoolEntriesForModel,
  findPoolBlockForModel,
  synthesizePoolBlock,
} = await import("@/sse/services/antigravityQuotaPools.js");
const { tierFromPaidTierId } = await import("open-sse/services/usage/antigravity-weekly.js");

const GEMINI = "gemini-3.8-flash-high";
const GEMINI_SIBLING = "gemini-3.7-flash-medium";
const GEMINI_IMAGE = "gemini-3.1-flash-image";
const CLAUDE = "claude-opus-4-6-thinking";
const CLAUDE_SIBLING = "claude-sonnet-4-6";
const GPT_OSS = "gpt-oss-120b-medium";

const NOW = "2026-09-13T12:00:00.000Z";
const WEEKLY_RESET = "2026-09-14T12:00:00.000Z"; // +24h
const FIVE_H_RESET = "2026-09-13T15:00:00.000Z"; // +3h
const LONG_RESET = "2026-09-15T02:00:00.000Z";   // +38h (weekly exhausted case)

function isoAt(nowIso, ms) {
  return new Date(Date.parse(nowIso) + ms).toISOString();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  getAntigravityQuotaCache().clear();
  mocks.resolveConnectionProxyConfig.mockResolvedValue({});
  mocks.getSettings.mockResolvedValue({});
});

describe("pool mapping", () => {
  it("maps every model family to the correct pool", () => {
    expect(getAntigravityQuotaPool(GEMINI)).toBe("gemini");
    expect(getAntigravityQuotaPool(GEMINI_SIBLING)).toBe("gemini");
    expect(getAntigravityQuotaPool(GEMINI_IMAGE)).toBe("gemini");
    expect(getAntigravityQuotaPool("gemini-3.1-pro-low")).toBe("gemini");
    expect(getAntigravityQuotaPool("gemini-pro-agent")).toBe("gemini");
    expect(getAntigravityQuotaPool(CLAUDE)).toBe("claude_gpt");
    expect(getAntigravityQuotaPool(CLAUDE_SIBLING)).toBe("claude_gpt");
    expect(getAntigravityQuotaPool(GPT_OSS)).toBe("claude_gpt");
    expect(getAntigravityQuotaPool("")).toBeNull();
  });

  it("collects pool entries: summary windows + per-model family", () => {
    const quotas = {
      [GEMINI]: { remainingPercentage: 10, resetAt: FIVE_H_RESET },
      [GEMINI_SIBLING]: { remainingPercentage: 10, resetAt: FIVE_H_RESET },
      gemini_weekly: { remainingPercentage: 72, resetAt: WEEKLY_RESET },
      gemini_5h: { remainingPercentage: 99, resetAt: FIVE_H_RESET },
      [CLAUDE]: { remainingPercentage: 0, resetAt: FIVE_H_RESET },
      claude_gpt_weekly: { remainingPercentage: 0, resetAt: WEEKLY_RESET },
      [GPT_OSS]: { remainingPercentage: 0, resetAt: FIVE_H_RESET },
    };
    const geminiEntries = getPoolEntriesForModel(quotas, GEMINI).map(e => e.key);
    expect(geminiEntries).toContain("gemini_weekly");
    expect(geminiEntries).toContain("gemini_5h");
    expect(geminiEntries).toContain(GEMINI);
    expect(geminiEntries).not.toContain(CLAUDE);

    const claudeEntries = getPoolEntriesForModel(quotas, CLAUDE).map(e => e.key);
    expect(claudeEntries).toContain("claude_gpt_weekly");
    expect(claudeEntries).toContain(CLAUDE);
    expect(claudeEntries).toContain(GPT_OSS);
    expect(claudeEntries).not.toContain(GEMINI);
  });

  it("maps paidTier ids to human tier labels", () => {
    expect(tierFromPaidTierId("free-tier")).toBe("Free");
    expect(tierFromPaidTierId("g1-plus-tier")).toBe("Plus");
    expect(tierFromPaidTierId("g1-pro-tier")).toBe("Pro");
    expect(tierFromPaidTierId("g1-ultra-tier")).toBe("Ultra");
    expect(tierFromPaidTierId(null)).toBeNull();
  });
});

describe("pool block detection", () => {
  // Pro account: claude_gpt weekly exhausted (5h disabled upstream), gemini
  // pool healthy — only the exhausted pool must be blocked.
  it("blocks only the exhausted pool while the sibling pool stays routable (pro tier)", async () => {
    const quotas = {
      gemini_weekly: { remainingPercentage: 72.05, resetAt: WEEKLY_RESET },
      gemini_5h: { remainingPercentage: 99.88, resetAt: FIVE_H_RESET, disabled: false },
      [GEMINI]: { remainingPercentage: 99.88, resetAt: FIVE_H_RESET },
      claude_gpt_weekly: { remainingPercentage: 0, resetAt: LONG_RESET },
      claude_gpt_5h: { remainingPercentage: 0, resetAt: FIVE_H_RESET, disabled: true },
      [CLAUDE]: { remainingPercentage: 0, resetAt: LONG_RESET },
      [GPT_OSS]: { remainingPercentage: 0, resetAt: LONG_RESET },
    };

    const claudeBlock = isAntigravityPoolBlocked(quotas, CLAUDE);
    expect(claudeBlock.blocked).toBe(true);
    expect(claudeBlock.reason).toBe("pool:claude_gpt");
    // Weekly is the binding window: block until the WEEKLY resetAt, not the 5h one.
    expect(claudeBlock.resetAt).toBe(LONG_RESET);

    const geminiBlock = isAntigravityPoolBlocked(quotas, GEMINI);
    expect(geminiBlock.blocked).toBe(false);

    // And routing agrees: gemini requests may use this account, claude may not.
    mocks.getProviderConnections.mockResolvedValue([{ id: "ag-pro", email: "pro@example.com", isActive: true }]);
    getAntigravityQuotaCache().set("ag-pro", quotas);
    await expect(getProviderCredentials("antigravity", null, GEMINI)).resolves.toMatchObject({ connectionId: "ag-pro" });
    await expect(getProviderCredentials("antigravity", null, CLAUDE)).resolves.toMatchObject({ allRateLimited: true });
  });

  it("uses the weekly resetAt (not the 5h one) when weekly is exhausted", () => {
    const quotas = {
      claude_gpt_weekly: { remainingPercentage: 0, resetAt: LONG_RESET },
      claude_gpt_5h: { remainingPercentage: 0, resetAt: FIVE_H_RESET, disabled: true },
    };
    const block = isAntigravityPoolBlocked(quotas, CLAUDE_SIBLING);
    expect(block.blocked).toBe(true);
    expect(block.resetAt).toBe(LONG_RESET);
  });

  // PRO SEMANTICS (user-confirmed): on paid tiers a request consumes BOTH
  // windows — an exhausted 5h window blocks the pool even if weekly still
  // shows headroom. Pro cannot borrow weekly quota.
  it("blocks the pool when the 5h window is exhausted even with weekly headroom (pro)", () => {
    const quotas = {
      gemini_weekly: { remainingPercentage: 72, resetAt: WEEKLY_RESET },
      gemini_5h: { remainingPercentage: 0, resetAt: FIVE_H_RESET, disabled: false },
    };
    const block = isAntigravityPoolBlocked(quotas, GEMINI_SIBLING);
    expect(block.blocked).toBe(true);
    expect(block.resetAt).toBe(FIVE_H_RESET);
    expect(block.reason).toBe("pool:gemini");
  });

  // Free/Plus: NO 5h bucket at all — a missing 5h entry must never block.
  it("free account with only weekly entries never blocks on missing 5h", () => {
    const quotas = {
      gemini_weekly: { remainingPercentage: 100, resetAt: WEEKLY_RESET },
      claude_gpt_weekly: { remainingPercentage: 0, resetAt: isoAt(NOW, 48 * 3600 * 1000) },
    };
    expect(isAntigravityPoolBlocked(quotas, GEMINI).blocked).toBe(false);
    expect(isAntigravityPoolBlocked(quotas, GEMINI_SIBLING).blocked).toBe(false);
    // The other pool is still blocked (its weekly is exhausted).
    expect(isAntigravityPoolBlocked(quotas, CLAUDE).blocked).toBe(true);
  });

  // Fully-loaded account: everything 100% — must never block.
  it("does not block when both pools have headroom", () => {
    const quotas = {
      gemini_weekly: { remainingPercentage: 100, resetAt: WEEKLY_RESET },
      gemini_5h: { remainingPercentage: 100, resetAt: FIVE_H_RESET },
      claude_gpt_weekly: { remainingPercentage: 100, resetAt: WEEKLY_RESET },
      claude_gpt_5h: { remainingPercentage: 100, resetAt: FIVE_H_RESET },
    };
    expect(isAntigravityPoolBlocked(quotas, GEMINI).blocked).toBe(false);
    expect(isAntigravityPoolBlocked(quotas, CLAUDE).blocked).toBe(false);
    expect(isAntigravityPoolBlocked(quotas, GEMINI_SIBLING).blocked).toBe(false);
    expect(isAntigravityPoolBlocked(quotas, GPT_OSS).blocked).toBe(false);
  });

  it("ignores expired blocks", () => {
    const quotas = {
      claude_gpt_weekly: { remainingPercentage: 0, resetAt: isoAt(NOW, -60_000) },
    };
    expect(isAntigravityPoolBlocked(quotas, CLAUDE).blocked).toBe(false);
  });
});

describe("pool block synthesis & propagation", () => {
  it("503 MODEL_CAPACITY_EXHAUSTED pool-blocks that account immediately, at any remaining percentage", async () => {
    // Upstream 503 "No capacity" is an authoritative "request doesn't fit"
    // signal: whatever the remaining percentage, the next turn of the same
    // task won't fit either. One probe → whole pool blocked until the pool's
    // own resetAt; other accounts keep routing the same model.
    const weeklyReset = isoAt(NOW, 40 * 3600 * 1000);
    mocks.getAntigravityUsage.mockResolvedValue({ quotas: {
      gemini_weekly: { remainingPercentage: 100, resetAt: WEEKLY_RESET },
      // NOTE: 12% remaining — comfortably above zero, yet upstream still
      // refused the request. The block must not depend on a threshold.
      claude_gpt_weekly: { remainingPercentage: 12, resetAt: weeklyReset },
    } });

    // Same call chat.js makes for antigravity 503 capacity errors.
    const resetMs = await handleAntigravityQuotaError("ag-near-zero", 503, CLAUDE, "token", {});
    expect(resetMs).toBe(Date.parse(weeklyReset));

    const cached = getAntigravityQuotaCache().get("ag-near-zero");
    expect(cached[CLAUDE_SIBLING]).toMatchObject({ remainingPercentage: 0 });
    expect(cached[GPT_OSS]).toMatchObject({ remainingPercentage: 0 });

    // Only THIS account is blocked — a sibling account with healthy pool
    // still routes the very same model.
    mocks.getProviderConnections.mockResolvedValue([
      { id: "ag-near-zero", email: "near-zero@example.com", isActive: true },
      { id: "ag-healthy", email: "healthy@example.com", isActive: true },
    ]);
    getAntigravityQuotaCache().set("ag-healthy", {
      claude_gpt_weekly: { remainingPercentage: 95, resetAt: WEEKLY_RESET },
    });
    await expect(getProviderCredentials("antigravity", null, CLAUDE)).resolves.toMatchObject({ connectionId: "ag-healthy" });
  });

  it("503 with no readable resetAt falls back to a 15-minute block", async () => {
    mocks.getAntigravityUsage.mockResolvedValue({ quotas: {
      // Snapshot carries no future resetAt — the block must still happen.
      claude_gpt_weekly: { remainingPercentage: 5, resetAt: isoAt(NOW, -1000) },
    } });

    const resetMs = await handleAntigravityQuotaError("ag-no-reset", 503, CLAUDE, "token", {});
    expect(resetMs).toBe(Date.parse(isoAt(NOW, 15 * 60 * 1000)));
    expect(getAntigravityQuotaCache().get("ag-no-reset")[CLAUDE]).toMatchObject({ remainingPercentage: 0 });
  });

  it("propagates a confirmed upstream block to every sibling in the pool", async () => {
    // External pool exhausted at request time.
    const weeklyReset = isoAt(NOW, 10 * 3600 * 1000);
    mocks.getAntigravityUsage.mockResolvedValue({ quotas: {
      gemini_weekly: { remainingPercentage: 30, resetAt: WEEKLY_RESET },
      [GEMINI]: { remainingPercentage: 30, resetAt: FIVE_H_RESET },
      claude_gpt_weekly: { remainingPercentage: 0, resetAt: weeklyReset },
      [CLAUDE]: { remainingPercentage: 0, resetAt: weeklyReset },
      [GPT_OSS]: { remainingPercentage: 0, resetAt: weeklyReset },
    } });

    const resetMs = await handleAntigravityQuotaError("ag-berinda", 429, CLAUDE, "token", {});
    expect(resetMs).toBe(Date.parse(weeklyReset));

    const cached = getAntigravityQuotaCache().get("ag-berinda");
    expect(cached[CLAUDE].remainingPercentage).toBe(0);
    expect(cached[CLAUDE_SIBLING].remainingPercentage).toBe(0);
    expect(cached[GPT_OSS].remainingPercentage).toBe(0);
    // Gemini siblings untouched.
    expect(cached[GEMINI_SIBLING]).toBeUndefined();
  });

  it("pool-exhausted refresh (no strikes) also synthesizes the pool block", async () => {
    const weeklyReset = isoAt(NOW, 20 * 3600 * 1000);
    mocks.getAntigravityUsage.mockResolvedValue({ quotas: {
      gemini_weekly: { remainingPercentage: 50, resetAt: WEEKLY_RESET },
      gemini_5h: { remainingPercentage: 50, resetAt: FIVE_H_RESET },
      claude_gpt_weekly: { remainingPercentage: 0, resetAt: weeklyReset },
      [CLAUDE]: { remainingPercentage: 0, resetAt: weeklyReset },
    } });

    await refreshAntigravityQuota("ag-refresh-pool", "token", {});

    const cached = getAntigravityQuotaCache().get("ag-refresh-pool");
    expect(cached[CLAUDE_SIBLING]).toMatchObject({ remainingPercentage: 0, resetAt: weeklyReset });
    expect(cached[GPT_OSS]).toMatchObject({ remainingPercentage: 0, resetAt: weeklyReset });
    expect(cached[GEMINI_SIBLING]).toBeUndefined();
  });

  it("strike-break blocks the whole pool, not just the struck model", async () => {
    // Quota API lies (optimistic 90%) — after 3 strikes the pool is blocked.
    mocks.getAntigravityUsage.mockResolvedValue({ quotas: {
      [GEMINI]: { remainingPercentage: 90, resetAt: FIVE_H_RESET },
    } });

    await handleAntigravityQuotaError("ag-strike-pool", 429, GEMINI, "token", {});
    await handleAntigravityQuotaError("ag-strike-pool", 429, GEMINI, "token", {});
    const blockedUntil = await handleAntigravityQuotaError("ag-strike-pool", 429, GEMINI, "token", {});
    expect(blockedUntil).toBe(Date.parse(isoAt(NOW, 15 * 60 * 1000)));

    const cached = getAntigravityQuotaCache().get("ag-strike-pool");
    expect(cached[GEMINI_SIBLING]).toMatchObject({ remainingPercentage: 0 });
    expect(cached.gemini_weekly).toMatchObject({ remainingPercentage: 0 });
    // The other pool is untouched.
    expect(cached[CLAUDE]).toBeUndefined();
    expect(cached.claude_gpt_weekly).toBeUndefined();
  });

  it("ingestAntigravityQuotaSnapshot warms the routing cache from a Quota Tracker refresh", async () => {
    // What /api/usage returns for a pro account whose claude_gpt pool is
    // exhausted: after ingest, routing must skip that pool with NO 429 probe.
    const { ingestAntigravityQuotaSnapshot } = await import("@/sse/services/antigravityQuota.js");
    const weeklyReset = isoAt(NOW, 30 * 3600 * 1000);
    ingestAntigravityQuotaSnapshot("ag-warm", {
      gemini_weekly: { remainingPercentage: 70, resetAt: WEEKLY_RESET },
      gemini_5h: { remainingPercentage: 95, resetAt: FIVE_H_RESET },
      claude_gpt_weekly: { remainingPercentage: 0, resetAt: weeklyReset },
      claude_gpt_5h: { remainingPercentage: 0, resetAt: FIVE_H_RESET, disabled: true },
    });

    // Sibling model never probed before is now cache-blocked pool-wide.
    const cached = getAntigravityQuotaCache().get("ag-warm");
    expect(cached[CLAUDE_SIBLING]).toMatchObject({ remainingPercentage: 0, resetAt: weeklyReset });
    expect(cached[GPT_OSS]).toMatchObject({ remainingPercentage: 0, resetAt: weeklyReset });
    expect(cached[GEMINI_SIBLING]).toBeUndefined();

    mocks.getProviderConnections.mockResolvedValue([{ id: "ag-warm", email: "warm@example.com", isActive: true }]);
    await expect(getProviderCredentials("antigravity", null, CLAUDE_SIBLING)).resolves.toMatchObject({ allRateLimited: true });
    await expect(getProviderCredentials("antigravity", null, GEMINI)).resolves.toMatchObject({ connectionId: "ag-warm" });
  });

  it("pool block on one account does not affect other accounts", async () => {
    const weeklyReset = isoAt(NOW, 5 * 3600 * 1000);
    mocks.getProviderConnections.mockResolvedValue([
      { id: "ag-a", email: "a@example.com", isActive: true },
      { id: "ag-b", email: "b@example.com", isActive: true },
    ]);
    getAntigravityQuotaCache().set("ag-a", synthesizePoolBlock({
      gemini_weekly: { remainingPercentage: 50, resetAt: WEEKLY_RESET },
      claude_gpt_weekly: { remainingPercentage: 0, resetAt: weeklyReset },
    }, CLAUDE, weeklyReset));

    await expect(getProviderCredentials("antigravity", null, CLAUDE)).resolves.toMatchObject({ connectionId: "ag-b" });
    await expect(getProviderCredentials("antigravity", null, GEMINI)).resolves.toMatchObject({ connectionId: "ag-a" });
  });
});

describe("pool functions are pure", () => {
  it("synthesizePoolBlock does not mutate its input", () => {
    const input = { gemini_weekly: { remainingPercentage: 50, resetAt: WEEKLY_RESET } };
    const output = synthesizePoolBlock(input, GEMINI, FIVE_H_RESET);
    expect(input.gemini_weekly.remainingPercentage).toBe(50);
    expect(output.gemini_weekly.remainingPercentage).toBe(0);
    expect(output).not.toBe(input);
  });
});
