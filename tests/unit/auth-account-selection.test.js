import { beforeEach, describe, expect, it, vi } from "vitest";

const mockConnections = [];
const getProviderConnections = vi.fn(async () => mockConnections);
const validateApiKey = vi.fn(async () => true);
const updateProviderConnection = vi.fn(async (id, data) => ({ id, ...data }));
const getSettings = vi.fn(async () => ({
  fallbackStrategy: "fill-first",
  stickyRoundRobinLimit: 3,
  providerStrategies: {},
}));
const getEligibleConnections = vi.fn(async () => null);
const writeConnectionHotState = vi.fn(async ({ patch }) => patch);
const projectLegacyConnectionState = vi.fn((snapshot = {}) => ({
  testStatus: snapshot.routingStatus === "blocked_quota" ? "unavailable" : "active",
  lastTested: snapshot.lastCheckedAt || null,
  lastError: snapshot.reasonDetail ?? snapshot.lastError ?? null,
  lastErrorType: snapshot.reasonCode && snapshot.reasonCode !== "unknown" ? snapshot.reasonCode : snapshot.lastErrorType ?? null,
  lastErrorAt: snapshot.lastErrorAt ?? null,
  rateLimitedUntil: snapshot.nextRetryAt ?? snapshot.rateLimitedUntil ?? null,
  errorCode: snapshot.errorCode ?? (snapshot.reasonCode && snapshot.reasonCode !== "unknown" ? snapshot.reasonCode : null),
}));
const resolveConnectionProxyConfig = vi.fn(async () => ({
  connectionProxyEnabled: false,
  connectionProxyUrl: "",
  connectionNoProxy: false,
  proxyPoolId: null,
  vercelRelayUrl: "",
}));
const applyLiveQuotaUpdate = vi.fn(async () => null);
const getCodexLiveQuotaSignal = vi.fn(() => null);

vi.mock("@/lib/localDb", () => ({
  getProviderConnections,
  validateApiKey,
  updateProviderConnection,
  getSettings,
}));

vi.mock("@/lib/providerHotState", () => ({
  getEligibleConnections,
  writeConnectionHotState,
  projectLegacyConnectionState,
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig,
}));

vi.mock("../../src/lib/usageStatus.js", async () => {
  const actual = await vi.importActual("../../src/lib/usageStatus.js");
  return {
    ...actual,
    applyLiveQuotaUpdate,
    getCodexLiveQuotaSignal,
  };
});

vi.mock("@/shared/constants/providers.js", () => ({
  resolveProviderId: (provider) => provider,
  FREE_PROVIDERS: {},
}));

vi.mock("open-sse/services/accountFallback.js", () => ({
  formatRetryAfter: vi.fn((value) => value),
  checkFallbackError: vi.fn(() => ({ shouldFallback: false, cooldownMs: 0, newBackoffLevel: 0 })),
  isModelLockActive: vi.fn((connection, model) => {
    if (!connection || !model) return false;
    const expiry = connection[`modelLock_${model}`] || connection.modelLock___all;
    return Boolean(expiry) && new Date(expiry).getTime() > Date.now();
  }),
  buildModelLockUpdate: vi.fn(() => ({ modelLock___all: null })),
  getEarliestModelLockUntil: vi.fn(() => null),
}));

describe("auth account selection", () => {
  beforeEach(() => {
    mockConnections.length = 0;
    getProviderConnections.mockClear();
    validateApiKey.mockClear();
    updateProviderConnection.mockClear();
    getSettings.mockClear();
    getEligibleConnections.mockClear();
    writeConnectionHotState.mockClear();
    projectLegacyConnectionState.mockClear();
    resolveConnectionProxyConfig.mockClear();
    applyLiveQuotaUpdate.mockClear();
    getCodexLiveQuotaSignal.mockClear();
    getProviderConnections.mockResolvedValue(mockConnections);
    getSettings.mockResolvedValue({
      fallbackStrategy: "fill-first",
      stickyRoundRobinLimit: 3,
      providerStrategies: {},
    });
    getEligibleConnections.mockResolvedValue(null);
    resolveConnectionProxyConfig.mockResolvedValue({
      connectionProxyEnabled: false,
      connectionProxyUrl: "",
      connectionNoProxy: false,
      proxyPoolId: null,
      vercelRelayUrl: "",
    });
    getCodexLiveQuotaSignal.mockReturnValue(null);
    vi.resetModules();
  });

  it("prefers centralized eligible accounts over merely available ones", async () => {
    mockConnections.push(
      {
        id: "conn-blocked",
        provider: "codex",
        isActive: true,
        priority: 1,
        displayName: "Blocked first",
        accessToken: "blocked-token",
        testStatus: "active",
      },
      {
        id: "conn-eligible",
        provider: "codex",
        isActive: true,
        priority: 2,
        displayName: "Eligible second",
        accessToken: "eligible-token",
        testStatus: "active",
      },
    );
    getEligibleConnections.mockResolvedValueOnce([mockConnections[1]]);

    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
    const credentials = await getProviderCredentials("codex", null, "gpt-4.1");

    expect(getEligibleConnections).toHaveBeenCalledWith("codex", expect.arrayContaining([
      expect.objectContaining({ id: "conn-blocked" }),
      expect.objectContaining({ id: "conn-eligible" }),
    ]));
    expect(credentials.connectionId).toBe("conn-eligible");
    expect(credentials.accessToken).toBe("eligible-token");
  });

  it("selects an untouched healthy account instead of falling back to a higher-priority blocked account", async () => {
    mockConnections.push(
      {
        id: "conn-blocked",
        provider: "codex",
        isActive: true,
        priority: 1,
        displayName: "Blocked first",
        accessToken: "blocked-token",
        testStatus: "active",
      },
      {
        id: "conn-untouched",
        provider: "codex",
        isActive: true,
        priority: 2,
        displayName: "Untouched second",
        accessToken: "healthy-token",
        testStatus: "active",
      },
    );
    getEligibleConnections.mockResolvedValueOnce([mockConnections[1]]);

    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
    const credentials = await getProviderCredentials("codex", null, "gpt-4.1");

    expect(credentials.connectionId).toBe("conn-untouched");
    expect(credentials.accessToken).toBe("healthy-token");
  });

  it("selects an untouched unknown-status account instead of falling back to a higher-priority blocked account", async () => {
    mockConnections.push(
      {
        id: "conn-blocked",
        provider: "codex",
        isActive: true,
        priority: 1,
        displayName: "Blocked first",
        accessToken: "blocked-token",
        testStatus: "active",
      },
      {
        id: "conn-untouched",
        provider: "codex",
        isActive: true,
        priority: 2,
        displayName: "Untouched second",
        accessToken: "healthy-token",
        testStatus: "unknown",
      },
    );
    getEligibleConnections.mockResolvedValueOnce([mockConnections[1]]);

    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
    const credentials = await getProviderCredentials("codex", null, "gpt-4.1");

    expect(credentials.connectionId).toBe("conn-untouched");
    expect(credentials.accessToken).toBe("healthy-token");
  });

  it("avoids excluded and model-locked accounts when using eligible selection", async () => {
    const futureLock = new Date(Date.now() + 60_000).toISOString();
    mockConnections.push(
      {
        id: "conn-excluded",
        provider: "codex",
        isActive: true,
        priority: 1,
        displayName: "Excluded",
        accessToken: "excluded-token",
        testStatus: "active",
      },
      {
        id: "conn-locked",
        provider: "codex",
        isActive: true,
        priority: 2,
        displayName: "Locked",
        accessToken: "locked-token",
        testStatus: "active",
        modelLock_gpt4: futureLock,
      },
      {
        id: "conn-eligible",
        provider: "codex",
        isActive: true,
        priority: 3,
        displayName: "Eligible",
        accessToken: "eligible-token",
        testStatus: "active",
      },
    );
    getEligibleConnections.mockImplementation(async (_provider, candidates) => candidates.filter((c) => c.id === "conn-eligible"));

    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
    const credentials = await getProviderCredentials("codex", new Set(["conn-excluded"]), "gpt4");

    expect(getEligibleConnections).toHaveBeenCalledWith("codex", [
      expect.objectContaining({ id: "conn-eligible" }),
    ]);
    expect(credentials.connectionId).toBe("conn-eligible");
  });

  it("does not fall back to raw available accounts when centralized eligibility is definitively empty", async () => {
    mockConnections.push(
      {
        id: "conn-blocked",
        provider: "codex",
        isActive: true,
        priority: 1,
        displayName: "Blocked first",
        accessToken: "blocked-token",
        testStatus: "active",
      },
      {
        id: "conn-second",
        provider: "codex",
        isActive: true,
        priority: 2,
        displayName: "Second",
        accessToken: "second-token",
        testStatus: "active",
      },
    );
    getEligibleConnections.mockResolvedValueOnce([]);

    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
    const credentials = await getProviderCredentials("codex", null, "gpt-4.1");

    expect(credentials).toBeNull();
  });

  it("falls back to canonical eligibility when centralized eligibility is unavailable", async () => {
    mockConnections.push(
      {
        id: "conn-blocked",
        provider: "codex",
        isActive: true,
        priority: 1,
        displayName: "Blocked",
        accessToken: "blocked-token",
        testStatus: "active",
        routingStatus: "blocked",
        authState: "invalid",
        healthStatus: "healthy",
        quotaState: "ok",
      },
      {
        id: "conn-eligible",
        provider: "codex",
        isActive: true,
        priority: 2,
        displayName: "Eligible",
        accessToken: "eligible-token",
        testStatus: "unavailable",
        routingStatus: "eligible",
        authState: "ok",
        healthStatus: "healthy",
        quotaState: "ok",
      },
    );
    getEligibleConnections.mockResolvedValueOnce(undefined);

    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
    const credentials = await getProviderCredentials("codex", null, "gpt-4.1");

    expect(credentials.connectionId).toBe("conn-eligible");
    expect(credentials.accessToken).toBe("eligible-token");
  });

  it("does not fall back to legacy testStatus when centralized eligibility is unavailable", async () => {
    mockConnections.push(
      {
        id: "conn-legacy-active",
        provider: "codex",
        isActive: true,
        priority: 1,
        displayName: "Legacy active",
        accessToken: "legacy-active-token",
        testStatus: "active",
      },
      {
        id: "conn-legacy-unknown",
        provider: "codex",
        isActive: true,
        priority: 2,
        displayName: "Legacy unknown",
        accessToken: "legacy-unknown-token",
        testStatus: "unknown",
      },
      {
        id: "conn-legacy-unavailable",
        provider: "codex",
        isActive: true,
        priority: 3,
        displayName: "Legacy unavailable",
        accessToken: "legacy-unavailable-token",
        testStatus: "unavailable",
      },
    );
    getEligibleConnections.mockResolvedValueOnce(null);

    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
    const credentials = await getProviderCredentials("codex", null, "gpt-4.1");

    expect(credentials).toBeNull();
  });

  it("applies immediate canonical exhausted state for Codex live quota failures before persisting model lock state", async () => {
    mockConnections.push({
      id: "conn-live",
      provider: "codex",
      isActive: true,
      priority: 1,
      displayName: "Live quota",
      accessToken: "token",
      testStatus: "active",
    });

    const { buildModelLockUpdate, checkFallbackError } = await import("open-sse/services/accountFallback.js");
    vi.mocked(checkFallbackError).mockReturnValueOnce({ shouldFallback: true, cooldownMs: 30000, newBackoffLevel: 2 });
    vi.mocked(buildModelLockUpdate).mockReturnValueOnce({ modelLock_gpt4: "2026-04-25T00:00:00.000Z" });
    getCodexLiveQuotaSignal.mockReturnValueOnce({
      kind: "quota_exhausted",
      reasonCode: "quota_exhausted",
      reasonDetail: "Codex quota exhausted",
      errorCode: "codex_live_quota_exhausted",
    });

    const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");
    const result = await markAccountUnavailable("conn-live", 429, "You have exceeded your current quota", "codex", "gpt4");

    expect(result).toEqual({ shouldFallback: true, cooldownMs: 30000 });
    expect(getCodexLiveQuotaSignal).toHaveBeenCalledWith(
      expect.objectContaining({ id: "conn-live", provider: "codex" }),
      expect.objectContaining({ statusCode: 429, errorText: "You have exceeded your current quota" })
    );
    expect(applyLiveQuotaUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "conn-live", provider: "codex" }),
      expect.objectContaining({ kind: "quota_exhausted" })
    );
    expect(updateProviderConnection).toHaveBeenCalledWith("conn-live", expect.objectContaining({
      modelLock_gpt4: "2026-04-25T00:00:00.000Z",
      routingStatus: "exhausted",
      quotaState: "exhausted",
      reasonCode: "quota_exhausted",
      reasonDetail: "Codex quota exhausted",
    }));
  });

  it("writes canonical exhausted state for generic Codex 429 throttling", async () => {
    mockConnections.push({
      id: "conn-throttle",
      provider: "codex",
      isActive: true,
      priority: 1,
      displayName: "Generic throttle",
      accessToken: "token",
      testStatus: "active",
    });

    const { buildModelLockUpdate, checkFallbackError } = await import("open-sse/services/accountFallback.js");
    vi.mocked(checkFallbackError).mockReturnValueOnce({ shouldFallback: true, cooldownMs: 15000, newBackoffLevel: 1 });
    vi.mocked(buildModelLockUpdate).mockReturnValueOnce({ modelLock_gpt4: "2026-04-25T00:00:00.000Z" });
    getCodexLiveQuotaSignal.mockReturnValueOnce(null);

    const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");
    const result = await markAccountUnavailable("conn-throttle", 429, "Rate limit exceeded. Too many requests.", "codex", "gpt4");

    expect(result).toEqual({ shouldFallback: true, cooldownMs: 15000 });
    expect(getCodexLiveQuotaSignal).toHaveBeenCalledWith(
      expect.objectContaining({ id: "conn-throttle", provider: "codex" }),
      expect.objectContaining({ statusCode: 429, errorText: "Rate limit exceeded. Too many requests." })
    );
    expect(applyLiveQuotaUpdate).not.toHaveBeenCalled();
    expect(writeConnectionHotState).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: "conn-throttle",
      provider: "codex",
      patch: expect.objectContaining({
        routingStatus: "exhausted",
        quotaState: "exhausted",
      }),
    }));
    expect(updateProviderConnection).toHaveBeenCalledWith("conn-throttle", expect.objectContaining({
      modelLock_gpt4: "2026-04-25T00:00:00.000Z",
      routingStatus: "exhausted",
      quotaState: "exhausted",
      reasonCode: "quota_exhausted",
      reasonDetail: "Rate limit exceeded. Too many requests.",
    }));
  });

  it("writes canonical blocked-auth state for confirmed live 401 failures", async () => {
    mockConnections.push({
      id: "conn-auth-blocked",
      provider: "codex",
      isActive: true,
      priority: 1,
      displayName: "Revoked account",
      accessToken: "token",
      testStatus: "active",
      routingStatus: "eligible",
      authState: "ok",
    });

    const { buildModelLockUpdate, checkFallbackError } = await import("open-sse/services/accountFallback.js");
    vi.mocked(checkFallbackError).mockReturnValueOnce({ shouldFallback: true, cooldownMs: 45000, newBackoffLevel: 3 });
    vi.mocked(buildModelLockUpdate).mockReturnValueOnce({ modelLock_gpt4: "2026-04-25T00:00:00.000Z" });
    getCodexLiveQuotaSignal.mockReturnValueOnce(null);

    const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");
    const result = await markAccountUnavailable("conn-auth-blocked", 401, "401 Unauthorized: token revoked", "codex", "gpt4");

    expect(result).toEqual({ shouldFallback: true, cooldownMs: 45000 });
    expect(writeConnectionHotState).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: "conn-auth-blocked",
      provider: "codex",
      patch: expect.objectContaining({
        routingStatus: "blocked",
        authState: "invalid",
      }),
    }));
    expect(updateProviderConnection).toHaveBeenCalledWith("conn-auth-blocked", expect.objectContaining({
      modelLock_gpt4: "2026-04-25T00:00:00.000Z",
      routingStatus: "blocked",
      authState: "invalid",
      reasonCode: "auth_invalid",
      reasonDetail: "401 Unauthorized: token revoked",
      backoffLevel: 3,
    }));
    expect(applyLiveQuotaUpdate).not.toHaveBeenCalled();
  });

  it("writes canonical blocked-auth state for confirmed live 401 failures with empty messages", async () => {
    mockConnections.push({
      id: "conn-auth-empty",
      provider: "codex",
      isActive: true,
      priority: 1,
      displayName: "Empty auth failure",
      accessToken: "token",
      testStatus: "active",
      routingStatus: "eligible",
      authState: "ok",
    });

    const { buildModelLockUpdate, checkFallbackError } = await import("open-sse/services/accountFallback.js");
    vi.mocked(checkFallbackError).mockReturnValueOnce({ shouldFallback: true, cooldownMs: 20000, newBackoffLevel: 1 });
    vi.mocked(buildModelLockUpdate).mockReturnValueOnce({ modelLock_gpt4: "2026-04-25T00:00:00.000Z" });
    getCodexLiveQuotaSignal.mockReturnValueOnce(null);

    const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");
    const result = await markAccountUnavailable("conn-auth-empty", 401, "", "codex", "gpt4");

    expect(result).toEqual({ shouldFallback: true, cooldownMs: 20000 });
    expect(writeConnectionHotState).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: "conn-auth-empty",
      provider: "codex",
      patch: expect.objectContaining({
        routingStatus: "blocked",
        authState: "invalid",
      }),
    }));
    expect(updateProviderConnection).toHaveBeenCalledWith("conn-auth-empty", expect.objectContaining({
      modelLock_gpt4: "2026-04-25T00:00:00.000Z",
      routingStatus: "blocked",
      authState: "invalid",
      quotaState: "ok",
      reasonCode: "auth_invalid",
      reasonDetail: "Provider error",
      backoffLevel: 1,
    }));
    expect(applyLiveQuotaUpdate).not.toHaveBeenCalled();
  });

  it("writes canonical blocked-auth state for confirmed live 403 failures", async () => {
    mockConnections.push({
      id: "conn-auth-403",
      provider: "codex",
      isActive: true,
      priority: 1,
      displayName: "Confirmed 403 auth failure",
      accessToken: "token",
      testStatus: "active",
      routingStatus: "eligible",
      authState: "ok",
    });

    const { buildModelLockUpdate, checkFallbackError } = await import("open-sse/services/accountFallback.js");
    vi.mocked(checkFallbackError).mockReturnValueOnce({ shouldFallback: true, cooldownMs: 25000, newBackoffLevel: 2 });
    vi.mocked(buildModelLockUpdate).mockReturnValueOnce({ modelLock_gpt4: "2026-04-25T00:00:00.000Z" });
    getCodexLiveQuotaSignal.mockReturnValueOnce(null);

    const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");
    const result = await markAccountUnavailable("conn-auth-403", 403, "Unauthorized: invalid token", "codex", "gpt4");

    expect(result).toEqual({ shouldFallback: true, cooldownMs: 25000 });
    expect(writeConnectionHotState).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: "conn-auth-403",
      provider: "codex",
      patch: expect.objectContaining({
        routingStatus: "blocked",
        authState: "invalid",
      }),
    }));
    expect(updateProviderConnection).toHaveBeenCalledWith("conn-auth-403", expect.objectContaining({
      modelLock_gpt4: "2026-04-25T00:00:00.000Z",
      routingStatus: "blocked",
      authState: "invalid",
      reasonCode: "auth_invalid",
      reasonDetail: "Unauthorized: invalid token",
      backoffLevel: 2,
    }));
    expect(applyLiveQuotaUpdate).not.toHaveBeenCalled();
  });

  it("writes canonical blocked-health state for live upstream 5xx failures", async () => {
    mockConnections.push({
      id: "conn-health-blocked",
      provider: "codex",
      isActive: true,
      priority: 1,
      displayName: "Unhealthy upstream",
      accessToken: "token",
      testStatus: "active",
      routingStatus: "eligible",
      healthStatus: "healthy",
    });

    const { buildModelLockUpdate, checkFallbackError } = await import("open-sse/services/accountFallback.js");
    vi.mocked(checkFallbackError).mockReturnValueOnce({ shouldFallback: true, cooldownMs: 15000, newBackoffLevel: 2 });
    vi.mocked(buildModelLockUpdate).mockReturnValueOnce({ modelLock_gpt4: "2026-04-25T00:00:00.000Z" });
    getCodexLiveQuotaSignal.mockReturnValueOnce(null);

    const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");
    const result = await markAccountUnavailable("conn-health-blocked", 503, "Provider health check failed", "codex", "gpt4");

    expect(result).toEqual({ shouldFallback: true, cooldownMs: 15000 });
    expect(updateProviderConnection).toHaveBeenCalledWith("conn-health-blocked", expect.objectContaining({
      modelLock_gpt4: "2026-04-25T00:00:00.000Z",
      routingStatus: "blocked",
      healthStatus: "unhealthy",
      authState: "ok",
      quotaState: "ok",
      reasonCode: "upstream_unhealthy",
      reasonDetail: "Provider health check failed",
      backoffLevel: 2,
    }));
    expect(applyLiveQuotaUpdate).not.toHaveBeenCalled();
  });

  it("uses fresh shared state before reactivating an account after clearing a model lock", async () => {
    const futureLock = new Date(Date.now() + 60_000).toISOString();
    const staleSelectedConnection = {
      id: "conn-stale",
      provider: "codex",
      displayName: "Stale snapshot",
      testStatus: "unavailable",
      lastError: "Old model locked",
      modelLock_gpt4: futureLock,
    };

    const freshSharedConnection = {
      ...staleSelectedConnection,
      modelLock_gpt5: futureLock,
    };

    getProviderConnections
      .mockResolvedValueOnce([freshSharedConnection]);

    const { clearAccountError } = await import("../../src/sse/services/auth.js");
    await clearAccountError("conn-stale", { _connection: staleSelectedConnection }, "gpt4");

    expect(getProviderConnections).toHaveBeenCalledWith({ provider: "codex" });
    expect(updateProviderConnection).toHaveBeenCalledWith("conn-stale", {
      modelLock_gpt4: null,
    });
    expect(updateProviderConnection).not.toHaveBeenCalledWith("conn-stale", expect.objectContaining({
      testStatus: "active",
      lastError: null,
    }));
  });

  it("clears centralized blocked state alongside legacy fields after successful recovery", async () => {
    const expiredLock = new Date(Date.now() - 60_000).toISOString();
    const staleSelectedConnection = {
      id: "conn-recover",
      provider: "codex",
      displayName: "Recover me",
      testStatus: "unavailable",
      lastError: "Quota exhausted",
      routingStatus: "blocked_quota",
      quotaState: "exhausted",
      authState: "ok",
      healthStatus: "degraded",
      reasonCode: "quota_exhausted",
      reasonDetail: "Codex quota exhausted",
      nextRetryAt: "2026-04-25T00:00:00.000Z",
      resetAt: "2026-04-25T00:00:00.000Z",
      errorCode: "weekly_quota_exhausted",
      backoffLevel: 2,
      modelLock_gpt4: expiredLock,
    };

    getProviderConnections.mockResolvedValueOnce([staleSelectedConnection]);

    const { clearAccountError } = await import("../../src/sse/services/auth.js");
    await clearAccountError("conn-recover", { _connection: staleSelectedConnection }, "gpt4");

    expect(updateProviderConnection).toHaveBeenCalledWith("conn-recover", expect.objectContaining({
      modelLock_gpt4: null,
      backoffLevel: 0,
      routingStatus: "eligible",
      quotaState: "ok",
      authState: "ok",
      healthStatus: "healthy",
      reasonCode: "unknown",
      reasonDetail: null,
      nextRetryAt: null,
      resetAt: null,
    }));
  });
});
