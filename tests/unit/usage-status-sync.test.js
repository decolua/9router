import { describe, it, expect, vi, beforeEach } from "vitest";

const mockConnections = [];
const updateProviderConnection = vi.fn(async (id, data) => ({ id, ...data }));
const getProviderConnectionById = vi.fn(async (id) => mockConnections.find((conn) => conn.id === id) || null);
const getUsageForProvider = vi.fn(async () => ({ ok: true }));
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
    needsRefresh: () => false,
    refreshCredentials: async () => null,
  }),
}));

vi.mock("../../src/lib/usageRefreshQueue.js", () => ({
  runUsageRefreshJob,
}));

describe("usage request status sync", () => {
  beforeEach(() => {
    mockConnections.length = 0;
    updateProviderConnection.mockClear();
    getProviderConnectionById.mockClear();
    getUsageForProvider.mockClear();
    writeConnectionHotState.mockClear();
    projectLegacyConnectionState.mockClear();
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
        routingStatus: "blocked_quota",
        quotaState: "exhausted",
        nextRetryAt: "2026-04-25T00:00:00.000Z",
      }),
    }));
    expect(updateProviderConnection).toHaveBeenCalledWith(
      "conn-weekly-exhausted",
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
        routingStatus: "blocked_quota",
        quotaState: "exhausted",
        errorCode: "weekly_quota_exhausted",
      }),
    }));
    expect(updateProviderConnection).toHaveBeenCalledWith(
      "conn-reuse",
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
        routingStatus: "blocked_quota",
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
});
