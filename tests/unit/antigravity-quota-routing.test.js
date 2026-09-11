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
  getObservedConnectionModelLock: vi.fn(),
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

const { getAntigravityQuotaCache, handleAntigravityQuotaError, refreshAntigravityQuota, clearAntigravityStrikes } = await import("@/sse/services/antigravityQuota.js");
const { getProviderCredentials } = await import("@/sse/services/auth.js");

const MODEL = "claude-opus-4-6-thinking";
const FUTURE_RESET = "2026-09-01T00:00:00.000Z";

beforeEach(() => {
  vi.clearAllMocks();
  getAntigravityQuotaCache().clear();
  mocks.resolveConnectionProxyConfig.mockResolvedValue({});
  mocks.getSettings.mockResolvedValue({});
});

describe("Antigravity quota-aware routing", () => {
  it("records exhausted upstream quota after 429 and returns its exact reset time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T00:00:00.000Z"));
    mocks.getAntigravityUsage.mockResolvedValue({ quotas: {
      [MODEL]: { remainingPercentage: 0, resetAt: FUTURE_RESET },
    } });

    try {
      await expect(handleAntigravityQuotaError("ag-a", 429, MODEL, "token", {}))
        .resolves.toBe(Date.parse(FUTURE_RESET));
      expect(getAntigravityQuotaCache().get("ag-a")[MODEL]).toEqual({
        remainingPercentage: 0,
        resetAt: FUTURE_RESET,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips exhausted account/model and selects the next account", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T00:00:00.000Z"));
    mocks.getProviderConnections.mockResolvedValue([
      { id: "ag-a", email: "a@example.com", isActive: true },
      { id: "ag-b", email: "b@example.com", isActive: true },
    ]);
    getAntigravityQuotaCache().set("ag-a", {
      [MODEL]: { remainingPercentage: 0, resetAt: FUTURE_RESET },
    });

    try {
      await expect(getProviderCredentials("antigravity", null, MODEL)).resolves.toMatchObject({
        connectionId: "ag-b",
        connectionName: "b@example.com",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports retry time when every account is cache-blocked", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T00:00:00.000Z"));
    mocks.getProviderConnections.mockResolvedValue([{ id: "ag-a", email: "a@example.com", isActive: true }]);
    getAntigravityQuotaCache().set("ag-a", {
      [MODEL]: { remainingPercentage: 0, resetAt: FUTURE_RESET },
    });

    try {
      await expect(getProviderCredentials("antigravity", null, MODEL)).resolves.toMatchObject({
        allRateLimited: true,
        retryAfter: FUTURE_RESET,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets account back into rotation once reset time has passed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T00:00:01.000Z"));
    mocks.getProviderConnections.mockResolvedValue([{ id: "ag-a", email: "a@example.com", isActive: true }]);
    getAntigravityQuotaCache().set("ag-a", {
      [MODEL]: { remainingPercentage: 0, resetAt: FUTURE_RESET },
    });

    try {
      await expect(getProviderCredentials("antigravity", null, MODEL)).resolves.toMatchObject({
        connectionId: "ag-a",
        connectionName: "a@example.com",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("coalesces concurrent quota refreshes for one account", async () => {
    let resolveUsage;
    mocks.getAntigravityUsage.mockReturnValue(new Promise(resolve => { resolveUsage = resolve; }));

    const first = refreshAntigravityQuota("ag-concurrent", "token", {});
    const second = refreshAntigravityQuota("ag-concurrent", "token", {});
    resolveUsage({ quotas: { [MODEL]: { remainingPercentage: 0, resetAt: FUTURE_RESET } } });

    await expect(Promise.all([first, second])).resolves.toEqual([
      { [MODEL]: { remainingPercentage: 0, resetAt: FUTURE_RESET } },
      { [MODEL]: { remainingPercentage: 0, resetAt: FUTURE_RESET } },
    ]);
    expect(mocks.getAntigravityUsage).toHaveBeenCalledTimes(1);
  });

  it("preserves strict proxy policy for usage refresh", async () => {
    mocks.resolveConnectionProxyConfig.mockResolvedValue({ strictProxy: true });
    mocks.getAntigravityUsage.mockResolvedValue({ quotas: {} });

    await refreshAntigravityQuota("ag-strict-proxy", "token", {});

    expect(mocks.getAntigravityUsage).toHaveBeenCalledWith("token", {}, expect.objectContaining({
      strictProxy: true,
    }));
  });

  it("keeps known cache when quota endpoint returns an error payload", async () => {
    const cached = { [MODEL]: { remainingPercentage: 0, resetAt: FUTURE_RESET } };
    getAntigravityQuotaCache().set("ag-error-response", cached);
    mocks.getAntigravityUsage.mockResolvedValue({ message: "Unauthorized", quotas: {} });

    await expect(refreshAntigravityQuota("ag-error-response", "token", {})).resolves.toBeNull();
    expect(getAntigravityQuotaCache().get("ag-error-response")).toBe(cached);
  });

  it("throttles failed refresh attempts for 30 seconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T00:00:00.000Z"));
    mocks.getAntigravityUsage.mockRejectedValue(new Error("usage unavailable"));

    try {
      await refreshAntigravityQuota("ag-failed-refresh", "token", {});
      await refreshAntigravityQuota("ag-failed-refresh", "token", {});
      expect(mocks.getAntigravityUsage).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(30_000);
      await refreshAntigravityQuota("ag-failed-refresh", "token", {});
      expect(mocks.getAntigravityUsage).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("strike-breaks after 3 optimistic 429s within 60s and cache-blocks 15 minutes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T00:00:00.000Z"));
    // Quota API lies: reports 90% remaining while generation keeps 429ing.
    mocks.getAntigravityUsage.mockResolvedValue({ quotas: {
      [MODEL]: { remainingPercentage: 90, resetAt: FUTURE_RESET },
    } });

    try {
      const first = await handleAntigravityQuotaError("ag-strike", 429, MODEL, "token", {});
      expect(first).toBeNull();
      const second = await handleAntigravityQuotaError("ag-strike", 429, MODEL, "token", {});
      expect(second).toBeNull();

      const third = await handleAntigravityQuotaError("ag-strike", 429, MODEL, "token", {});
      expect(third).toBe(Date.parse("2026-08-26T00:15:00.000Z"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("resets the strike counter when strikes fall outside the 60s window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T00:00:00.000Z"));
    mocks.getAntigravityUsage.mockResolvedValue({ quotas: {
      [MODEL]: { remainingPercentage: 90, resetAt: FUTURE_RESET },
    } });

    try {
      await handleAntigravityQuotaError("ag-window", 429, MODEL, "token", {});
      await handleAntigravityQuotaError("ag-window", 429, MODEL, "token", {});
      await vi.advanceTimersByTimeAsync(61_000);
      const result = await handleAntigravityQuotaError("ag-window", 429, MODEL, "token", {});
      expect(result).toBeNull(); // window lapsed — counter restarted at 1
    } finally {
      vi.useRealTimers();
    }
  });

  it("strike-breaks when the quota API is unavailable (null reading) too", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T00:00:00.000Z"));
    // Quota endpoint failing/forbidden => quota unknown. Strikes must still count.
    mocks.getAntigravityUsage.mockResolvedValue({ message: "forbidden", quotas: {} });

    try {
      await handleAntigravityQuotaError("ag-null", 429, MODEL, "token", {});
      await handleAntigravityQuotaError("ag-null", 429, MODEL, "token", {});
      const third = await handleAntigravityQuotaError("ag-null", 429, MODEL, "token", {});
      expect(third).toBe(Date.parse("2026-08-26T00:15:00.000Z"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("persists the block into the shared cache so the next request skips the pair", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T00:00:00.000Z"));
    mocks.getAntigravityUsage.mockResolvedValue({ quotas: {
      [MODEL]: { remainingPercentage: 90, resetAt: FUTURE_RESET },
    } });

    try {
      await handleAntigravityQuotaError("ag-persist", 429, MODEL, "token", {});
      await handleAntigravityQuotaError("ag-persist", 429, MODEL, "token", {});
      await handleAntigravityQuotaError("ag-persist", 429, MODEL, "token", {});

      // The synthesized entry must be visible to the auth pre-filter reading
      // the shared cache — and must survive an optimistic upstream refresh.
      const cached = getAntigravityQuotaCache().get("ag-persist")?.[MODEL];
      expect(cached).toMatchObject({ remainingPercentage: 0 });
      expect(Date.parse(cached.resetAt)).toBe(Date.parse("2026-08-26T00:15:00.000Z"));

      await refreshAntigravityQuota("ag-persist", "token", {});
      expect(getAntigravityQuotaCache().get("ag-persist")?.[MODEL]).toMatchObject({
        remainingPercentage: 0,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears strike state and the synthesized block after a successful request", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T00:00:00.000Z"));
    mocks.getAntigravityUsage.mockResolvedValue({ quotas: {
      [MODEL]: { remainingPercentage: 90, resetAt: FUTURE_RESET },
    } });

    try {
      await handleAntigravityQuotaError("ag-clear", 429, MODEL, "token", {});
      await handleAntigravityQuotaError("ag-clear", 429, MODEL, "token", {});
      await handleAntigravityQuotaError("ag-clear", 429, MODEL, "token", {});
      expect(getAntigravityQuotaCache().get("ag-clear")?.[MODEL]?.remainingPercentage).toBe(0);

      clearAntigravityStrikes("ag-clear", MODEL);
      // Synthesized entry gone — pair selectable again immediately.
      expect(getAntigravityQuotaCache().get("ag-clear")?.[MODEL]).toBeUndefined();

      // Two more 429s do NOT inherit earlier strikes: no block on the third-in-episode.
      await handleAntigravityQuotaError("ag-clear", 429, MODEL, "token", {});
      await expect(handleAntigravityQuotaError("ag-clear", 429, MODEL, "token", {})).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("anchors the window at the first strike: 3 strikes spread over 90s do not trip", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T00:00:00.000Z"));
    mocks.getAntigravityUsage.mockResolvedValue({ quotas: {
      [MODEL]: { remainingPercentage: 90, resetAt: FUTURE_RESET },
    } });

    try {
      await handleAntigravityQuotaError("ag-anchor", 429, MODEL, "token", {});      // t=0
      await vi.advanceTimersByTimeAsync(45_000);
      await handleAntigravityQuotaError("ag-anchor", 429, MODEL, "token", {});      // t=45s
      await vi.advanceTimersByTimeAsync(45_000);
      // t=90s: within 60s of strike #2 but outside 60s of strike #1 => new window
      const result = await handleAntigravityQuotaError("ag-anchor", 429, MODEL, "token", {});
      expect(result).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the optimistic path null without touching the quota cache", async () => {
    mocks.getAntigravityUsage.mockResolvedValue({ quotas: {
      [MODEL]: { remainingPercentage: 90, resetAt: FUTURE_RESET },
    } });

    await expect(handleAntigravityQuotaError("ag-optimistic", 429, MODEL, "token", {}))
      .resolves.toBeNull();
    // Optimistic reading must NOT poison the shared cache (auth pre-filter
    // treats cached 0% as exhausted).
    expect(getAntigravityQuotaCache().get("ag-optimistic")?.[MODEL]?.remainingPercentage).toBe(90);
  });
});
