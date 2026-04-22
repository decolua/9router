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

  it("falls back to available accounts when centralized eligibility is unavailable", async () => {
    mockConnections.push(
      {
        id: "conn-first",
        provider: "codex",
        isActive: true,
        priority: 1,
        displayName: "First",
        accessToken: "first-token",
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
    getEligibleConnections.mockResolvedValueOnce(null);

    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
    const credentials = await getProviderCredentials("codex", null, "gpt-4.1");

    expect(credentials.connectionId).toBe("conn-first");
  });

  it("filters legacy blocked and account-wide cooldown state when centralized eligibility is unavailable", async () => {
    const futureCooldown = new Date(Date.now() + 60_000).toISOString();
    mockConnections.push(
      {
        id: "conn-unavailable",
        provider: "codex",
        isActive: true,
        priority: 1,
        displayName: "Unavailable",
        accessToken: "unavailable-token",
        testStatus: "unavailable",
      },
      {
        id: "conn-error",
        provider: "codex",
        isActive: true,
        priority: 2,
        displayName: "Error",
        accessToken: "error-token",
        testStatus: "error",
      },
      {
        id: "conn-expired",
        provider: "codex",
        isActive: true,
        priority: 3,
        displayName: "Expired",
        accessToken: "expired-token",
        testStatus: "expired",
      },
      {
        id: "conn-rate-limited",
        provider: "codex",
        isActive: true,
        priority: 4,
        displayName: "Rate limited",
        accessToken: "rate-limited-token",
        testStatus: "active",
        rateLimitedUntil: futureCooldown,
      },
      {
        id: "conn-account-locked",
        provider: "codex",
        isActive: true,
        priority: 5,
        displayName: "Account locked",
        accessToken: "account-locked-token",
        testStatus: "active",
        modelLock___all: futureCooldown,
      },
      {
        id: "conn-healthy",
        provider: "codex",
        isActive: true,
        priority: 6,
        displayName: "Healthy",
        accessToken: "healthy-token",
        testStatus: "active",
      },
    );
    getEligibleConnections.mockResolvedValueOnce(null);

    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
    const credentials = await getProviderCredentials("codex", null, "gpt-4.1");

    expect(credentials.connectionId).toBe("conn-healthy");
    expect(credentials.accessToken).toBe("healthy-token");
  });

  it("keeps fallback model-lock filtering model-aware while excluding account-wide locks", async () => {
    const futureCooldown = new Date(Date.now() + 60_000).toISOString();
    mockConnections.push(
      {
        id: "conn-other-model-lock",
        provider: "codex",
        isActive: true,
        priority: 1,
        displayName: "Other model lock",
        accessToken: "other-model-token",
        testStatus: "active",
        modelLock_gpt5: futureCooldown,
      },
      {
        id: "conn-all-models-lock",
        provider: "codex",
        isActive: true,
        priority: 2,
        displayName: "All models lock",
        accessToken: "all-models-token",
        testStatus: "active",
        modelLock___all: futureCooldown,
      },
      {
        id: "conn-second-choice",
        provider: "codex",
        isActive: true,
        priority: 3,
        displayName: "Second choice",
        accessToken: "second-token",
        testStatus: "active",
      },
    );
    getEligibleConnections.mockResolvedValueOnce(null);

    const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
    const credentials = await getProviderCredentials("codex", null, "gpt4");

    expect(credentials.connectionId).toBe("conn-other-model-lock");
    expect(credentials.accessToken).toBe("other-model-token");
  });

  it("applies an immediate Codex live quota update before persisting model lock state", async () => {
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
      testStatus: "unavailable",
    }));
    expect(updateProviderConnection).not.toHaveBeenCalledWith("conn-live", expect.objectContaining({
      lastError: "You have exceeded your current quota",
      errorCode: 429,
    }));
  });

  it("does not apply live quota update for generic Codex 429 throttling", async () => {
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
    expect(updateProviderConnection).toHaveBeenCalledWith("conn-throttle", expect.objectContaining({
      modelLock_gpt4: "2026-04-25T00:00:00.000Z",
      testStatus: "unavailable",
      lastError: "Rate limit exceeded. Too many requests.",
      errorCode: 429,
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
    expect(updateProviderConnection).toHaveBeenCalledWith("conn-auth-blocked", expect.objectContaining({
      modelLock_gpt4: "2026-04-25T00:00:00.000Z",
      routingStatus: "blocked_auth",
      authState: "invalid",
      reasonCode: "auth_invalid",
      reasonDetail: "401 Unauthorized: token revoked",
      testStatus: "expired",
      lastError: "401 Unauthorized: token revoked",
      lastErrorType: "auth_invalid",
      errorCode: "auth_invalid",
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
    expect(updateProviderConnection).toHaveBeenCalledWith("conn-auth-empty", expect.objectContaining({
      modelLock_gpt4: "2026-04-25T00:00:00.000Z",
      routingStatus: "blocked_auth",
      authState: "invalid",
      quotaState: "ok",
      reasonCode: "auth_invalid",
      reasonDetail: "Provider error",
      testStatus: "expired",
      lastError: "Provider error",
      lastErrorType: "auth_invalid",
      errorCode: "auth_invalid",
      backoffLevel: 1,
    }));
    expect(applyLiveQuotaUpdate).not.toHaveBeenCalled();
  });

  it("writes canonical blocked-auth state for confirmed live 403 failures with atypical messages", async () => {
    mockConnections.push({
      id: "conn-auth-atypical",
      provider: "codex",
      isActive: true,
      priority: 1,
      displayName: "Atypical auth failure",
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
    const result = await markAccountUnavailable("conn-auth-atypical", 403, "Request failed", "codex", "gpt4");

    expect(result).toEqual({ shouldFallback: true, cooldownMs: 25000 });
    expect(updateProviderConnection).toHaveBeenCalledWith("conn-auth-atypical", expect.objectContaining({
      modelLock_gpt4: "2026-04-25T00:00:00.000Z",
      routingStatus: "blocked_auth",
      authState: "invalid",
      quotaState: "ok",
      reasonCode: "auth_invalid",
      reasonDetail: "Request failed",
      testStatus: "expired",
      lastError: "Request failed",
      lastErrorType: "auth_invalid",
      errorCode: "auth_invalid",
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
      testStatus: "active",
      lastError: null,
      lastErrorAt: null,
      lastErrorType: null,
      rateLimitedUntil: null,
      errorCode: null,
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
