import { describe, it, expect, vi, beforeEach } from "vitest";

const mockConnections = [];
const updateProviderConnection = vi.fn(async (id, data) => ({ id, ...data }));
const getProviderConnectionById = vi.fn(async (id) => mockConnections.find((conn) => conn.id === id) || null);
const getProviderConnections = vi.fn(async ({ provider } = {}) => {
  if (!provider) return [...mockConnections];
  return mockConnections.filter((conn) => conn.provider === provider);
});
const getUsageForProvider = vi.fn(async () => ({ ok: true }));
const writeConnectionHotState = vi.fn(async ({ patch }) => patch);
const needsRefresh = vi.fn(() => false);
const refreshCredentials = vi.fn(async () => null);
const projectLegacyConnectionState = vi.fn((snapshot = {}) => ({
  testStatus:
    snapshot.routingStatus === "exhausted"
      ? "unavailable"
      : snapshot.routingStatus === "blocked"
        ? (snapshot.reasonCode && snapshot.reasonCode.startsWith("auth_") ? "expired" : "error")
        : "active",
  lastTested: snapshot.lastCheckedAt || null,
  lastError: snapshot.reasonDetail ?? snapshot.lastError ?? null,
  lastErrorType: snapshot.reasonCode && snapshot.reasonCode !== "unknown" ? snapshot.reasonCode : snapshot.lastErrorType ?? null,
  lastErrorAt: snapshot.lastErrorAt ?? null,
  rateLimitedUntil: snapshot.nextRetryAt ?? snapshot.rateLimitedUntil ?? null,
  errorCode: snapshot.errorCode ?? (snapshot.reasonCode && snapshot.reasonCode !== "unknown" ? snapshot.reasonCode : null),
}));
const runUsageRefreshJob = vi.fn(async (_connectionId, handler) => handler());

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    }),
  },
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById,
  getProviderConnections,
  updateProviderConnection,
}));

vi.mock("@/lib/providerHotState", () => ({
  writeConnectionHotState,
  projectLegacyConnectionState,
}));

vi.mock("open-sse/services/usage.js", () => ({
  getUsageForProvider,
}));

vi.mock("open-sse/index.js", () => ({}));

vi.mock("open-sse/executors/index.js", () => ({
  getExecutor: () => ({
    needsRefresh,
    refreshCredentials,
  }),
}));

vi.mock("../../src/lib/usageRefreshQueue.js", () => ({
  runUsageRefreshJob,
}));

vi.mock("@/lib/connectionStatus", async () => await import("../../src/lib/connectionStatus.js"));

describe("usage request status sync", () => {
  beforeEach(() => {
    mockConnections.length = 0;
    updateProviderConnection.mockClear();
    getProviderConnectionById.mockClear();
    getProviderConnections.mockClear();
    getUsageForProvider.mockClear();
    writeConnectionHotState.mockClear();
    projectLegacyConnectionState.mockClear();
    needsRefresh.mockClear();
    refreshCredentials.mockClear();
    needsRefresh.mockImplementation(() => false);
    refreshCredentials.mockImplementation(async () => null);
    runUsageRefreshJob.mockClear();
    runUsageRefreshJob.mockImplementation(async (_connectionId, handler) => handler());
    vi.resetModules();
  });

  it("marks the connection active after successful usage fetch", async () => {
    mockConnections.push({
      id: "conn-1",
      provider: "codex",
      authType: "oauth",
      accessToken: "token",
      refreshToken: "refresh",
      testStatus: "unknown",
    });

    const { GET } = await import("../../src/app/api/usage/[connectionId]/route.js");
    const response = await GET(new Request("http://localhost/api/usage/conn-1"), {
      params: Promise.resolve({ connectionId: "conn-1" }),
    });

    expect(response.status).toBe(200);
    expect(writeConnectionHotState).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: "conn-1",
      provider: "codex",
      patch: expect.objectContaining({
        routingStatus: "eligible",
        quotaState: "ok",
      }),
    }));
    expect(updateProviderConnection).toHaveBeenCalledWith("conn-1", expect.objectContaining({
      testStatus: "active",
      lastError: null,
      lastErrorType: null,
      lastErrorAt: null,
    }));
  });

  it("marks weekly-only Codex connections unavailable when weekly quota is exhausted", async () => {
    mockConnections.push({
      id: "conn-weekly-exhausted",
      provider: "codex",
      authType: "oauth",
      accessToken: "token",
      refreshToken: "refresh",
      testStatus: "unknown",
    });

    getUsageForProvider.mockResolvedValueOnce({
      plan: "free",
      quotas: {
        weekly: {
          used: 100,
          total: 100,
          remaining: 0,
          resetAt: "2026-04-25T00:00:00.000Z",
        },
      },
    });

    const { GET } = await import("../../src/app/api/usage/[connectionId]/route.js");
    const response = await GET(new Request("http://localhost/api/usage/conn-weekly-exhausted"), {
      params: Promise.resolve({ connectionId: "conn-weekly-exhausted" }),
    });

    expect(response.status).toBe(200);
    expect(writeConnectionHotState).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: "conn-weekly-exhausted",
      provider: "codex",
      patch: expect.objectContaining({
        routingStatus: "exhausted",
        quotaState: "exhausted",
        nextRetryAt: "2026-04-25T00:00:00.000Z",
      }),
    }));
    expect(updateProviderConnection).toHaveBeenCalledWith(
      "conn-weekly-exhausted",
      expect.objectContaining({ testStatus: "unavailable" })
    );
  });

  it("marks Codex connections unavailable when session quota is exhausted even if weekly quota remains", async () => {
    mockConnections.push({
      id: "conn-session-exhausted",
      provider: "codex",
      authType: "oauth",
      accessToken: "token",
      refreshToken: "refresh",
      testStatus: "unknown",
    });

    getUsageForProvider.mockResolvedValueOnce({
      plan: "pro",
      quotas: {
        session: {
          used: 100,
          total: 100,
          remaining: 0,
          resetAt: "2026-04-25T00:00:00.000Z",
        },
        weekly: {
          used: 10,
          total: 100,
          remaining: 90,
          resetAt: "2026-04-27T00:00:00.000Z",
        },
      },
    });

    const { GET } = await import("../../src/app/api/usage/[connectionId]/route.js");
    const response = await GET(new Request("http://localhost/api/usage/conn-session-exhausted"), {
      params: Promise.resolve({ connectionId: "conn-session-exhausted" }),
    });

    expect(response.status).toBe(200);
    expect(writeConnectionHotState).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: "conn-session-exhausted",
      provider: "codex",
      patch: expect.objectContaining({
        routingStatus: "exhausted",
        quotaState: "exhausted",
        nextRetryAt: "2026-04-25T00:00:00.000Z",
        reasonDetail: "Codex session quota exhausted",
        errorCode: "session_quota_exhausted",
      }),
    }));
    expect(updateProviderConnection).toHaveBeenCalledWith(
      "conn-session-exhausted",
      expect.objectContaining({ testStatus: "unavailable" })
    );
  });

  it("keeps weekly-only Codex connections active when weekly quota remains", async () => {
    mockConnections.push({
      id: "conn-weekly-active",
      provider: "codex",
      authType: "oauth",
      accessToken: "token",
      refreshToken: "refresh",
      testStatus: "unknown",
    });

    getUsageForProvider.mockResolvedValueOnce({
      plan: "free",
      quotas: {
        weekly: {
          used: 55,
          total: 100,
          remaining: 45,
          resetAt: "2026-04-25T00:00:00.000Z",
        },
      },
    });

    const { GET } = await import("../../src/app/api/usage/[connectionId]/route.js");
    const response = await GET(new Request("http://localhost/api/usage/conn-weekly-active"), {
      params: Promise.resolve({ connectionId: "conn-weekly-active" }),
    });

    expect(response.status).toBe(200);
    expect(writeConnectionHotState).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: "conn-weekly-active",
      provider: "codex",
      patch: expect.objectContaining({
        routingStatus: "eligible",
        quotaState: "ok",
      }),
    }));
    expect(updateProviderConnection).toHaveBeenCalledWith(
      "conn-weekly-active",
      expect.objectContaining({ testStatus: "active" })
    );
  });

  it("exports canonical usage refresh logic that scheduler code can reuse", async () => {
    const { applyCanonicalUsageRefresh } = await import("../../src/lib/usageStatus.js");

    await applyCanonicalUsageRefresh({ id: "conn-reuse", provider: "codex" }, {
      plan: "free",
      limitReached: true,
      quotas: {
        weekly: {
          used: 100,
          total: 100,
          remaining: 0,
          resetAt: "2026-04-25T00:00:00.000Z",
        },
      },
    });

    expect(writeConnectionHotState).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: "conn-reuse",
      provider: "codex",
      patch: expect.objectContaining({
        routingStatus: "exhausted",
        quotaState: "exhausted",
        errorCode: "weekly_quota_exhausted",
      }),
    }));
    expect(updateProviderConnection).toHaveBeenCalledWith(
      "conn-reuse",
      expect.objectContaining({ testStatus: "unavailable" })
    );
  });

  it("marks codex as exhausted when remaining falls below the default global threshold", async () => {
    const { applyCanonicalUsageRefresh } = await import("../../src/lib/usageStatus.js");

    await applyCanonicalUsageRefresh({ id: "conn-threshold-default", provider: "codex" }, {
      plan: "pro",
      quotas: {
        weekly: {
          used: 91,
          total: 100,
          remaining: 9,
          resetAt: "2026-04-25T00:00:00.000Z",
        },
      },
    });

    expect(writeConnectionHotState).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: "conn-threshold-default",
      provider: "codex",
      patch: expect.objectContaining({
        routingStatus: "exhausted",
        quotaState: "exhausted",
        reasonCode: "quota_threshold",
        nextRetryAt: "2026-04-25T00:00:00.000Z",
      }),
    }));
  });

  it("blocks Kiro connections when a valid remaining percent falls at or below the configured threshold", async () => {
    const { applyCanonicalUsageRefresh } = await import("../../src/lib/usageStatus.js");

    await applyCanonicalUsageRefresh(
      {
        id: "conn-kiro-threshold",
        provider: "kiro",
        providerSpecificData: { minimumRemainingQuotaPercent: 25 },
      },
      {
        plan: "Kiro",
        quotas: {
          agentic_request: {
            used: 80,
            total: 100,
            resetAt: "2026-04-25T00:00:00.000Z",
          },
        },
      }
    );

    expect(writeConnectionHotState).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: "conn-kiro-threshold",
      provider: "kiro",
      patch: expect.objectContaining({
        routingStatus: "exhausted",
        quotaState: "exhausted",
        reasonCode: "quota_threshold",
        nextRetryAt: "2026-04-25T00:00:00.000Z",
      }),
    }));
    expect(updateProviderConnection).toHaveBeenCalledWith(
      "conn-kiro-threshold",
      expect.objectContaining({ testStatus: "unavailable" })
    );
  });

  it("does not block Kiro threshold routing when remaining percent cannot be determined safely", async () => {
    const { applyCanonicalUsageRefresh } = await import("../../src/lib/usageStatus.js");

    await applyCanonicalUsageRefresh(
      {
        id: "conn-kiro-unknown-total",
        provider: "kiro",
        providerSpecificData: { minimumRemainingQuotaPercent: 25 },
      },
      {
        plan: "Kiro",
        quotas: {
          agentic_request: {
            used: 80,
            total: 0,
            resetAt: "2026-04-25T00:00:00.000Z",
          },
        },
      }
    );

    expect(writeConnectionHotState).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: "conn-kiro-unknown-total",
      provider: "kiro",
      patch: expect.objectContaining({
        routingStatus: "eligible",
        quotaState: "ok",
      }),
    }));
    expect(updateProviderConnection).toHaveBeenCalledWith(
      "conn-kiro-unknown-total",
      expect.objectContaining({ testStatus: "active" })
    );
  });

  it("still blocks Kiro connections on explicit non-threshold exhaustion signals", async () => {
    const { applyCanonicalUsageRefresh } = await import("../../src/lib/usageStatus.js");

    await applyCanonicalUsageRefresh(
      {
        id: "conn-kiro-exhausted",
        provider: "kiro",
        providerSpecificData: { minimumRemainingQuotaPercent: 25 },
      },
      {
        plan: "Kiro",
        limitReached: true,
        quotas: {
          agentic_request: {
            used: 5,
            total: 0,
            resetAt: "2026-04-25T00:00:00.000Z",
          },
        },
      }
    );

    expect(writeConnectionHotState).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: "conn-kiro-exhausted",
      provider: "kiro",
      patch: expect.objectContaining({
        routingStatus: "exhausted",
        quotaState: "exhausted",
        reasonCode: "quota_exhausted",
      }),
    }));
    expect(updateProviderConnection).toHaveBeenCalledWith(
      "conn-kiro-exhausted",
      expect.objectContaining({ testStatus: "unavailable" })
    );
  });

  it("applies immediate live Codex quota exhaustion updates without polling usage again", async () => {
    const { applyLiveQuotaUpdate, getCodexLiveQuotaSignal } = await import("../../src/lib/usageStatus.js");

    const signal = getCodexLiveQuotaSignal(
      { id: "conn-live", provider: "codex" },
      { statusCode: 429, errorText: "You have exceeded your current quota. Limit reached." }
    );

    expect(signal).toEqual(expect.objectContaining({
      kind: "quota_exhausted",
      reasonCode: "quota_exhausted",
    }));

    await applyLiveQuotaUpdate({ id: "conn-live", provider: "codex" }, signal);

    expect(writeConnectionHotState).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: "conn-live",
      provider: "codex",
      patch: expect.objectContaining({
        routingStatus: "exhausted",
        quotaState: "exhausted",
        errorCode: "codex_live_quota_exhausted",
        reasonDetail: "Codex quota exhausted",
      }),
    }));
    expect(updateProviderConnection).toHaveBeenCalledWith(
      "conn-live",
      expect.objectContaining({ testStatus: "unavailable" })
    );
    expect(getUsageForProvider).not.toHaveBeenCalled();
  });

  it("does not treat generic Codex 429 throttling as quota exhaustion", async () => {
    const { getCodexLiveQuotaSignal } = await import("../../src/lib/usageStatus.js");

    const signal = getCodexLiveQuotaSignal(
      { id: "conn-throttle", provider: "codex" },
      { statusCode: 429, errorText: "Rate limit exceeded. Too many requests, please retry later." }
    );

    expect(signal).toBeNull();
  });

  it("preserves queue overload status codes from the usage refresh queue", async () => {
    mockConnections.push({
      id: "conn-overloaded",
      provider: "codex",
      authType: "oauth",
      accessToken: "token",
      refreshToken: "refresh",
      testStatus: "unknown",
    });

    runUsageRefreshJob.mockRejectedValueOnce(Object.assign(
      new Error("Usage refresh queue is overloaded. Please retry shortly."),
      { status: 503 },
    ));

    const { GET } = await import("../../src/app/api/usage/[connectionId]/route.js");
    const response = await GET(new Request("http://localhost/api/usage/conn-overloaded"), {
      params: Promise.resolve({ connectionId: "conn-overloaded" }),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Usage refresh queue is overloaded. Please retry shortly.",
    });
    expect(getUsageForProvider).not.toHaveBeenCalled();
  });

  it("writes canonical blocked-auth state when credential refresh confirms re-authorization is required", async () => {
    mockConnections.push({
      id: "conn-refresh-auth-fail",
      provider: "codex",
      authType: "oauth",
      accessToken: "stale-token",
      refreshToken: "refresh",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      routingStatus: "eligible",
      authState: "ok",
      testStatus: "active",
    });

    needsRefresh.mockReturnValueOnce(true);
    refreshCredentials.mockRejectedValueOnce(new Error("Token expired and refresh failed"));

    const { GET } = await import("../../src/app/api/usage/[connectionId]/route.js");
    const response = await GET(new Request("http://localhost/api/usage/conn-refresh-auth-fail"), {
      params: Promise.resolve({ connectionId: "conn-refresh-auth-fail" }),
    });

    expect(response.status).toBe(401);
    expect(writeConnectionHotState).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: "conn-refresh-auth-fail",
      provider: "codex",
      patch: expect.objectContaining({
        routingStatus: "blocked",
        authState: "invalid",
        reasonCode: "auth_invalid",
        reasonDetail: "Token expired and refresh failed",
        testStatus: "blocked",
        lastErrorType: "auth_invalid",
      }),
    }));
    expect(updateProviderConnection).toHaveBeenCalledWith(
      "conn-refresh-auth-fail",
      expect.objectContaining({
        testStatus: "expired",
        lastError: "Token expired and refresh failed",
        lastErrorType: "auth_invalid",
        errorCode: "auth_invalid",
      })
    );
  });

  it("writes canonical blocked-auth state when auth-expired usage retry cannot refresh", async () => {
    mockConnections.push({
      id: "conn-usage-auth-fail",
      provider: "codex",
      authType: "oauth",
      accessToken: "token",
      refreshToken: "refresh",
      routingStatus: "eligible",
      authState: "ok",
      testStatus: "active",
    });

    getUsageForProvider.mockResolvedValueOnce({
      message: "Authentication expired. Please sign in again.",
    });
    refreshCredentials.mockRejectedValueOnce(new Error("Token expired and refresh failed"));

    const { GET } = await import("../../src/app/api/usage/[connectionId]/route.js");
    const response = await GET(new Request("http://localhost/api/usage/conn-usage-auth-fail"), {
      params: Promise.resolve({ connectionId: "conn-usage-auth-fail" }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Credential refresh failed: Token expired and refresh failed",
    });
    expect(writeConnectionHotState).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: "conn-usage-auth-fail",
      provider: "codex",
      patch: expect.objectContaining({
        routingStatus: "blocked",
        authState: "invalid",
        reasonCode: "auth_invalid",
        reasonDetail: "Token expired and refresh failed",
        testStatus: "blocked",
        lastErrorType: "auth_invalid",
      }),
    }));
    expect(updateProviderConnection).toHaveBeenCalledWith(
      "conn-usage-auth-fail",
      expect.objectContaining({
        testStatus: "expired",
        lastError: "Token expired and refresh failed",
        lastErrorType: "auth_invalid",
        errorCode: "auth_invalid",
      })
    );
  });

  it("writes canonical blocked-auth state when refresh requires re-authorization", async () => {
    mockConnections.push({
      id: "conn-reauthorize-required",
      provider: "codex",
      authType: "oauth",
      accessToken: null,
      refreshToken: "refresh",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      routingStatus: "eligible",
      authState: "ok",
      testStatus: "active",
    });

    needsRefresh.mockReturnValueOnce(true);
    refreshCredentials.mockResolvedValueOnce(null);

    const { GET } = await import("../../src/app/api/usage/[connectionId]/route.js");
    const response = await GET(new Request("http://localhost/api/usage/conn-reauthorize-required"), {
      params: Promise.resolve({ connectionId: "conn-reauthorize-required" }),
    });

    expect(response.status).toBe(401);
    expect(writeConnectionHotState).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: "conn-reauthorize-required",
      provider: "codex",
      patch: expect.objectContaining({
        routingStatus: "blocked",
        authState: "invalid",
        reasonCode: "auth_invalid",
        reasonDetail: "Failed to refresh credentials. Please re-authorize the connection.",
        testStatus: "blocked",
        lastErrorType: "auth_invalid",
      }),
    }));
    expect(updateProviderConnection).toHaveBeenCalledWith(
      "conn-reauthorize-required",
      expect.objectContaining({
        testStatus: "expired",
        lastError: "Failed to refresh credentials. Please re-authorize the connection.",
        lastErrorType: "auth_invalid",
        errorCode: "auth_invalid",
      })
    );
  });

  it("writes canonical blocked-auth state when usage fetch throws unauthorized error", async () => {
    mockConnections.push({
      id: "conn-usage-throws-unauthorized",
      provider: "codex",
      authType: "oauth",
      accessToken: "token",
      refreshToken: "refresh",
      routingStatus: "eligible",
      authState: "ok",
      testStatus: "active",
    });

    getUsageForProvider.mockRejectedValueOnce(Object.assign(
      new Error("401 Unauthorized: token revoked"),
      { status: 401 },
    ));

    const { GET } = await import("../../src/app/api/usage/[connectionId]/route.js");
    const response = await GET(new Request("http://localhost/api/usage/conn-usage-throws-unauthorized"), {
      params: Promise.resolve({ connectionId: "conn-usage-throws-unauthorized" }),
    });

    expect(response.status).toBe(401);
    expect(writeConnectionHotState).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: "conn-usage-throws-unauthorized",
      provider: "codex",
      patch: expect.objectContaining({
        routingStatus: "blocked",
        authState: "invalid",
        reasonCode: "auth_invalid",
        reasonDetail: "401 Unauthorized: token revoked",
        testStatus: "blocked",
        lastErrorType: "auth_invalid",
      }),
    }));
    expect(updateProviderConnection).toHaveBeenCalledWith(
      "conn-usage-throws-unauthorized",
      expect.objectContaining({
        testStatus: "expired",
        lastError: "401 Unauthorized: token revoked",
        lastErrorType: "auth_invalid",
        errorCode: "auth_invalid",
      })
    );
  });

  it("writes canonical blocked-auth state when usage fetch throws generic 401 error", async () => {
    mockConnections.push({
      id: "conn-usage-throws-generic-401",
      provider: "codex",
      authType: "oauth",
      accessToken: "token",
      refreshToken: "refresh",
      routingStatus: "eligible",
      authState: "ok",
      testStatus: "active",
    });

    getUsageForProvider.mockRejectedValueOnce(Object.assign(
      new Error("Request failed"),
      { status: 401 },
    ));

    const { GET } = await import("../../src/app/api/usage/[connectionId]/route.js");
    const response = await GET(new Request("http://localhost/api/usage/conn-usage-throws-generic-401"), {
      params: Promise.resolve({ connectionId: "conn-usage-throws-generic-401" }),
    });

    expect(response.status).toBe(401);
    expect(writeConnectionHotState).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: "conn-usage-throws-generic-401",
      provider: "codex",
      patch: expect.objectContaining({
        routingStatus: "blocked",
        authState: "invalid",
        reasonCode: "auth_invalid",
        reasonDetail: "Request failed",
        testStatus: "blocked",
        lastErrorType: "auth_invalid",
      }),
    }));
    expect(updateProviderConnection).toHaveBeenCalledWith(
      "conn-usage-throws-generic-401",
      expect.objectContaining({
        testStatus: "expired",
        lastError: "Request failed",
        lastErrorType: "auth_invalid",
        errorCode: "auth_invalid",
      })
    );
  });

  it("does not classify generic 403 usage errors as auth-blocked", async () => {
    mockConnections.push({
      id: "conn-usage-throws-generic-403",
      provider: "codex",
      authType: "oauth",
      accessToken: "token",
      refreshToken: "refresh",
      routingStatus: "eligible",
      authState: "ok",
      testStatus: "active",
    });

    getUsageForProvider.mockRejectedValueOnce(Object.assign(
      new Error("Request failed"),
      { status: 403 },
    ));

    const { GET } = await import("../../src/app/api/usage/[connectionId]/route.js");
    const response = await GET(new Request("http://localhost/api/usage/conn-usage-throws-generic-403"), {
      params: Promise.resolve({ connectionId: "conn-usage-throws-generic-403" }),
    });

    expect(response.status).toBe(403);
    expect(writeConnectionHotState).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: "conn-usage-throws-generic-403",
      provider: "codex",
      patch: expect.objectContaining({
        testStatus: "error",
        lastError: "Request failed",
        lastErrorType: "usage_request_failed",
      }),
    }));
    expect(updateProviderConnection).toHaveBeenCalledWith(
      "conn-usage-throws-generic-403",
      expect.objectContaining({
        testStatus: "error",
        lastError: "Request failed",
        lastErrorType: "usage_request_failed",
      })
    );
  });

  it("classifies 403 usage errors as auth-blocked when auth evidence is present", async () => {
    mockConnections.push({
      id: "conn-usage-throws-auth-403",
      provider: "codex",
      authType: "oauth",
      accessToken: "token",
      refreshToken: "refresh",
      routingStatus: "eligible",
      authState: "ok",
      testStatus: "active",
    });

    getUsageForProvider.mockRejectedValueOnce(Object.assign(
      new Error("Access denied: invalid token"),
      { status: 403 },
    ));

    const { GET } = await import("../../src/app/api/usage/[connectionId]/route.js");
    const response = await GET(new Request("http://localhost/api/usage/conn-usage-throws-auth-403"), {
      params: Promise.resolve({ connectionId: "conn-usage-throws-auth-403" }),
    });

    expect(response.status).toBe(403);
    expect(writeConnectionHotState).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: "conn-usage-throws-auth-403",
      provider: "codex",
      patch: expect.objectContaining({
        routingStatus: "blocked",
        authState: "invalid",
        reasonCode: "auth_invalid",
        reasonDetail: "Access denied: invalid token",
        testStatus: "blocked",
        lastErrorType: "auth_invalid",
      }),
    }));
    expect(updateProviderConnection).toHaveBeenCalledWith(
      "conn-usage-throws-auth-403",
      expect.objectContaining({
        testStatus: "expired",
        lastError: "Access denied: invalid token",
        lastErrorType: "auth_invalid",
        errorCode: "auth_invalid",
      })
    );
  });

  it("maps Codex 429 quota failures to canonical exhausted state", async () => {
    mockConnections.push({
      id: "conn-usage-throws-quota-429",
      provider: "codex",
      authType: "oauth",
      accessToken: "token",
      refreshToken: "refresh",
      routingStatus: "eligible",
      quotaState: "ok",
      testStatus: "active",
    });

    getUsageForProvider.mockRejectedValueOnce(Object.assign(
      new Error("You have exceeded your current quota. Limit reached."),
      { status: 429 },
    ));

    const { GET } = await import("../../src/app/api/usage/[connectionId]/route.js");
    const response = await GET(new Request("http://localhost/api/usage/conn-usage-throws-quota-429"), {
      params: Promise.resolve({ connectionId: "conn-usage-throws-quota-429" }),
    });

    expect(response.status).toBe(429);
    expect(writeConnectionHotState).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: "conn-usage-throws-quota-429",
      provider: "codex",
      patch: expect.objectContaining({
        routingStatus: "exhausted",
        quotaState: "exhausted",
        reasonCode: "quota_exhausted",
        testStatus: "unavailable",
      }),
    }));
    expect(updateProviderConnection).toHaveBeenCalledWith(
      "conn-usage-throws-quota-429",
      expect.objectContaining({
        testStatus: "unavailable",
        lastErrorType: "quota_exhausted",
      })
    );
  });

  it("returns canonical blocked model availability entries", async () => {
    mockConnections.push({
      id: "conn-availability-blocked",
      provider: "codex",
      name: "Blocked Conn",
      routingStatus: "blocked",
      authState: "invalid",
      reasonDetail: "Token revoked",
    });

    const { GET } = await import("../../src/app/api/models/availability/route.js");
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.models).toContainEqual(expect.objectContaining({
      provider: "codex",
      model: "__all",
      status: "blocked",
      connectionId: "conn-availability-blocked",
      connectionName: "Blocked Conn",
      lastError: "Token revoked",
    }));
  });

  it("returns canonical exhausted model availability entries with provider cooldown", async () => {
    const until = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    mockConnections.push({
      id: "conn-availability-exhausted",
      provider: "codex",
      email: "exhausted@example.com",
      routingStatus: "exhausted",
      quotaState: "exhausted",
      nextRetryAt: until,
      reasonDetail: "Quota exhausted",
    });

    const { GET } = await import("../../src/app/api/models/availability/route.js");
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.models).toContainEqual(expect.objectContaining({
      provider: "codex",
      model: "__all",
      status: "exhausted",
      until,
      connectionId: "conn-availability-exhausted",
      connectionName: "exhausted@example.com",
      lastError: "Quota exhausted",
    }));
  });

  it("reactivates clearCooldown only when canonical status becomes eligible", async () => {
    const lockUntil = new Date(Date.now() + 2 * 60 * 1000).toISOString();
    mockConnections.push({
      id: "conn-clear-eligible",
      provider: "codex",
      routingStatus: "eligible",
      authState: "ok",
      quotaState: "ok",
      testStatus: "unavailable",
      modelLock_gpt4: lockUntil,
      lastError: "temporary lock",
    });

    const { POST } = await import("../../src/app/api/models/availability/route.js");
    const response = await POST(new Request("http://localhost/api/models/availability", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "clearCooldown", provider: "codex", model: "__all" }),
    }));

    expect(response.status).toBe(200);
    expect(updateProviderConnection).toHaveBeenCalledWith(
      "conn-clear-eligible",
      expect.objectContaining({
        modelLock_gpt4: null,
        testStatus: "active",
        lastError: null,
        reasonCode: null,
        reasonDetail: null,
      })
    );
  });

  it("does not reactivate clearCooldown when canonical status remains blocked", async () => {
    const lockUntil = new Date(Date.now() + 2 * 60 * 1000).toISOString();
    mockConnections.push({
      id: "conn-clear-blocked",
      provider: "codex",
      routingStatus: "blocked",
      authState: "invalid",
      reasonCode: "auth_invalid",
      reasonDetail: "Token revoked",
      testStatus: "blocked",
      modelLock_gpt4: lockUntil,
    });

    const { POST } = await import("../../src/app/api/models/availability/route.js");
    const response = await POST(new Request("http://localhost/api/models/availability", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "clearCooldown", provider: "codex", model: "__all" }),
    }));

    expect(response.status).toBe(200);
    expect(updateProviderConnection).toHaveBeenCalledWith(
      "conn-clear-blocked",
      expect.objectContaining({
        modelLock_gpt4: null,
      })
    );
    expect(updateProviderConnection).not.toHaveBeenCalledWith(
      "conn-clear-blocked",
      expect.objectContaining({ testStatus: "active" })
    );
  });
});
