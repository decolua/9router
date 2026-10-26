import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  getUsageForProvider: vi.fn(),
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
  USAGE_APIKEY_PROVIDERS: ["opencode-go"],
  resolveProviderId: (provider) => provider,
}));
vi.mock("open-sse/services/usage.js", () => ({ getUsageForProvider: mocks.getUsageForProvider }));
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }));

const { recordQuotaUsage, clearQuotaReserveCache, getQuotaReserveHold, settleQuotaReserveRefreshes } = await import("@/sse/services/quotaReserve.js");
const { getProviderCredentials } = await import("@/sse/services/auth.js");

const FUTURE = "2999-01-01T00:00:00.000Z";
const account = (id, priority, quotaReserve, extra = {}) => ({
  id, provider: "codex", authType: "apikey", priority, apiKey: `key-${id}`,
  providerSpecificData: quotaReserve ? { quotaReserve } : {}, ...extra,
});
const codexUsage = (fiveHourLeft, weeklyLeft) => ({
  session: { used: 100 - fiveHourLeft, total: 100, remaining: fiveHourLeft, resetAt: FUTURE },
  weekly: { used: 100 - weeklyLeft, total: 100, remaining: weeklyLeft, resetAt: FUTURE },
});

beforeEach(() => {
  vi.clearAllMocks();
  clearQuotaReserveCache();
  mocks.resolveConnectionProxyConfig.mockResolvedValue({});
  mocks.getSettings.mockResolvedValue({});
});

describe("quota reserve routing", () => {
  it("moves to the next account once the first is down to its reserve", async () => {
    mocks.getProviderConnections.mockResolvedValue([account("main", 1, { "7d": 20 }), account("spare", 2, null)]);
    recordQuotaUsage("main", codexUsage(80, 18));
    recordQuotaUsage("spare", codexUsage(100, 100));

    const creds = await getProviderCredentials("codex");
    expect(creds.connectionId).toBe("spare");
  });

  it("keeps the first account while it is above every reserved window", async () => {
    mocks.getProviderConnections.mockResolvedValue([account("main", 1, { "5h": 10, "7d": 20 }), account("spare", 2, null)]);
    recordQuotaUsage("main", codexUsage(11, 21));

    expect((await getProviderCredentials("codex")).connectionId).toBe("main");
  });

  it("uses an account at its reserve rather than failing when all are there", async () => {
    mocks.getProviderConnections.mockResolvedValue([account("main", 1, { "7d": 20 }), account("spare", 2, { "7d": 30 })]);
    recordQuotaUsage("main", codexUsage(90, 10));
    recordQuotaUsage("spare", codexUsage(90, 25));

    expect((await getProviderCredentials("codex")).connectionId).toBe("main");
  });

  it("ignores a window whose reset already passed", () => {
    recordQuotaUsage("main", { weekly: { used: 95, total: 100, remaining: 5, resetAt: "2000-01-01T00:00:00.000Z" } });
    expect(getQuotaReserveHold(account("main", 1, { "7d": 20 }))).toBeNull();
  });

  it("does not block an account it has no usage for yet, and reads usage in the background", async () => {
    const conn = account("go", 1, { "7d": 20 }, { provider: "opencode-go" });
    mocks.getUsageForProvider.mockResolvedValue({ quotas: { Weekly: { used: 90, total: 100, remaining: 10, resetAt: FUTURE } } });

    expect(getQuotaReserveHold(conn)).toBeNull();
    await settleQuotaReserveRefreshes();
    expect(mocks.getUsageForProvider).toHaveBeenCalledTimes(1);
    expect(getQuotaReserveHold(conn)).toMatchObject({ window: "7d", remaining: 10, reserve: 20 });
  });

  it("does nothing for accounts without a reserve", async () => {
    mocks.getProviderConnections.mockResolvedValue([account("main", 1, null), account("spare", 2, null)]);
    recordQuotaUsage("main", codexUsage(1, 1));

    expect((await getProviderCredentials("codex")).connectionId).toBe("main");
    expect(mocks.getUsageForProvider).not.toHaveBeenCalled();
  });
});
