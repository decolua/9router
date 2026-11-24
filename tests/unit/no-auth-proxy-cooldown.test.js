import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
  getSettings: vi.fn(),
  getProxyPools: vi.fn(),
  getProxyPoolById: vi.fn(),
  updateProxyPool: vi.fn(),
}));

const proxyMocks = vi.hoisted(() => ({
  pickProxyPoolId: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
}));

vi.mock("@/lib/localDb", () => dbMocks);
vi.mock("@/lib/network/connectionProxy", () => proxyMocks);
vi.mock("@/shared/constants/providers.js", () => ({
  FREE_PROVIDERS: { opencode: { noAuth: true } },
  resolveProviderId: (provider) => provider,
}));
vi.mock("@/sse/utils/logger.js", () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

const {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
} = await import("../../src/sse/services/auth.js");

function makePool(id, state = {}) {
  return {
    id,
    proxyUrl: `http://${id}.example.test:8080`,
    isActive: true,
    rateLimitState: state,
  };
}

function installPoolStore(pools) {
  dbMocks.getProxyPools.mockImplementation(async () => pools);
  dbMocks.getProxyPoolById.mockImplementation(async (id) => pools.find((pool) => pool.id === id) || null);
  dbMocks.updateProxyPool.mockImplementation(async (id, data) => {
    const pool = pools.find((candidate) => candidate.id === id);
    if (pool) Object.assign(pool, data);
    return pool;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getSettings.mockResolvedValue({
    providerStrategies: {
      opencode: { rotateStrategy: "round-robin" },
    },
  });
  dbMocks.getProviderConnections.mockResolvedValue([]);
  proxyMocks.pickProxyPoolId.mockImplementation((poolIds) => poolIds[0] || null);
  proxyMocks.resolveConnectionProxyConfig.mockImplementation(async ({ proxyPoolId }) => ({
    connectionProxyEnabled: Boolean(proxyPoolId),
    connectionProxyUrl: proxyPoolId ? `http://${proxyPoolId}.example.test:8080` : "",
    connectionNoProxy: "",
    proxyPoolId: proxyPoolId || null,
    vercelRelayUrl: "",
  }));
});

describe("no-auth proxy-pool rate-limit fallback", () => {
  it("rotates from a pool that returned 429 to the next available pool", async () => {
    const pools = [makePool("pool-a"), makePool("pool-b")];
    installPoolStore(pools);

    const firstCredentials = await getProviderCredentials("opencode", null, "deepseek-v4-flash-free");
    expect(firstCredentials.connectionId).toBe("noauth");
    expect(firstCredentials.providerSpecificData.connectionProxyPoolId).toBe("pool-a");

    const failure = await markAccountUnavailable(
      "noauth",
      429,
      "Too Many Requests",
      "opencode",
      "deepseek-v4-flash-free",
      null,
      "pool-a",
    );
    expect(failure.shouldFallback).toBe(true);
    expect(pools[0].rateLimitState.opencode.backoffLevel).toBe(1);

    const secondCredentials = await getProviderCredentials(
      "opencode",
      new Set(["noauth"]),
      "deepseek-v4-flash-free",
      { excludeProxyPoolIds: new Set(["pool-a"]) },
    );
    expect(secondCredentials.providerSpecificData.connectionProxyPoolId).toBe("pool-b");
    expect(proxyMocks.pickProxyPoolId).toHaveBeenLastCalledWith(["pool-b"], "round-robin", "opencode");
  });

  it("treats FreeUsageLimitError as a rate limit and skips the cooled pool", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T00:00:00.000Z"));

    try {
      const pools = [makePool("pool-a"), makePool("pool-b")];
      installPoolStore(pools);

      const failure = await markAccountUnavailable(
        "noauth",
        500,
        "FreeUsageLimitError: retry later",
        "opencode",
        "deepseek-v4-flash-free",
        null,
        "pool-a",
      );
      expect(failure.shouldFallback).toBe(true);
      expect(pools[0].rateLimitState.opencode).toMatchObject({
        cooldownUntil: "2026-08-13T00:00:02.000Z",
        backoffLevel: 1,
      });

      const credentials = await getProviderCredentials("opencode", null, "deepseek-v4-flash-free");
      expect(credentials.providerSpecificData.connectionProxyPoolId).toBe("pool-b");
      expect(proxyMocks.pickProxyPoolId).toHaveBeenLastCalledWith(["pool-b"], "round-robin", "opencode");
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns the earliest retry time when every pool is cooling down", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T00:00:00.000Z"));

    try {
      const pools = [
        makePool("pool-a", { opencode: { cooldownUntil: "2026-08-13T00:00:10.000Z", lastError: "429 from A" } }),
        makePool("pool-b", { opencode: { cooldownUntil: "2026-08-13T00:00:20.000Z", lastError: "429 from B" } }),
      ];
      installPoolStore(pools);

      const credentials = await getProviderCredentials("opencode", null, "deepseek-v4-flash-free");
      expect(credentials).toMatchObject({
        allRateLimited: true,
        retryAfter: "2026-08-13T00:00:10.000Z",
        retryAfterHuman: "reset after 10s",
        lastErrorCode: 429,
      });
      expect(proxyMocks.pickProxyPoolId).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops after all pools in the current request were attempted", async () => {
    const pools = [makePool("pool-a"), makePool("pool-b")];
    installPoolStore(pools);

    const credentials = await getProviderCredentials(
      "opencode",
      null,
      "deepseek-v4-flash-free",
      { excludeProxyPoolIds: new Set(["pool-a", "pool-b"]) },
    );
    expect(credentials).toMatchObject({
      allRateLimited: true,
      lastErrorCode: 429,
      retryAfterHuman: "retry after 1s",
    });
  });

  it("clears provider-specific pool cooldown after a successful request", async () => {
    const pools = [makePool("pool-a", {
      opencode: {
        cooldownUntil: "2099-01-01T00:00:00.000Z",
        backoffLevel: 3,
        lastError: "429",
      },
    })];
    installPoolStore(pools);

    await clearAccountError(
      "noauth",
      { providerSpecificData: { connectionProxyPoolId: "pool-a" } },
      "deepseek-v4-flash-free",
      "opencode",
    );

    expect(dbMocks.updateProxyPool).toHaveBeenCalledWith("pool-a", { rateLimitState: {} });
    expect(pools[0].rateLimitState).toEqual({});
  });

  it("keeps authenticated-provider fallback behavior unchanged", async () => {
    dbMocks.getProviderConnections.mockResolvedValue([{
      id: "account-a",
      provider: "opencode",
      backoffLevel: 0,
    }]);

    const result = await markAccountUnavailable("account-a", 429, "rate limit", "opencode", "model");

    expect(result.shouldFallback).toBe(true);
    expect(dbMocks.updateProviderConnection).toHaveBeenCalledWith(
      "account-a",
      expect.objectContaining({
        modelLock_model: expect.any(String),
        errorCode: 429,
      }),
    );
    expect(dbMocks.updateProxyPool).not.toHaveBeenCalled();
  });
});
