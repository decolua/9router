import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: vi.fn(),
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(),
}));

vi.mock("@/app/api/usage/[connectionId]/route.js", () => ({
  refreshAndUpdateCredentials: vi.fn(),
}));

vi.mock("open-sse/services/usage/codex.js", () => ({
  getCodexUsage: vi.fn(),
}));

vi.mock("open-sse/services/codexGo.js", () => ({
  refreshCodexGoSession: vi.fn(),
}));

import {
  getProviderConnectionById,
  getProviderConnections,
  updateProviderConnection,
} from "@/lib/localDb";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { refreshAndUpdateCredentials } from "@/app/api/usage/[connectionId]/route.js";
import { getCodexUsage } from "open-sse/services/usage/codex.js";
import { refreshCodexGoSession } from "open-sse/services/codexGo.js";

function codexGoConnection(overrides = {}) {
  return {
    id: "conn-1",
    provider: "codex",
    authType: "oauth",
    accessToken: "old-access",
    refreshToken: "integration-secret",
    providerSpecificData: {
      authMethod: "codexgo",
      codexGoRefreshConfig: {
        hourlyLimit: 1,
        autoEnabled: true,
        thresholdRemainingPercent: 5,
      },
    },
    ...overrides,
  };
}

function refreshedCredentials() {
  return {
    accessToken: "new-access",
    refreshToken: "integration-secret",
    email: "codexgo@example.com",
    providerSpecificData: {
      authMethod: "codexgo",
      chatgptAccountId: "acct-1",
    },
  };
}

describe("CodexGo auto refresh scheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    resolveConnectionProxyConfig.mockResolvedValue({});
    refreshAndUpdateCredentials.mockImplementation(async (connection) => ({ connection, refreshed: false }));
    updateProviderConnection.mockImplementation(async (id, updates) => ({ id, ...updates }));
  });

  it("refreshes when session quota remaining is at threshold", async () => {
    const connection = codexGoConnection();
    getProviderConnections.mockResolvedValueOnce([connection]);
    getCodexUsage.mockResolvedValueOnce({ quotas: { session: { remaining: 5 }, weekly: { remaining: 80 } } });
    refreshCodexGoSession.mockResolvedValueOnce(refreshedCredentials());

    const { tickCodexGoAutoRefresh } = await import("../../src/shared/services/codexGoAutoRefresh.js");
    await tickCodexGoAutoRefresh({ nowMs: Date.parse("2026-07-07T10:00:00.000Z") });

    expect(refreshCodexGoSession).toHaveBeenCalledWith("integration-secret", console, expect.any(Object));
    expect(updateProviderConnection).toHaveBeenCalledWith("conn-1", expect.objectContaining({
      accessToken: "new-access",
      providerSpecificData: expect.objectContaining({
        codexGoRefreshState: expect.objectContaining({
          lastRefreshReason: "auto_threshold",
          events: [expect.objectContaining({ reason: "auto_threshold" })],
        }),
      }),
    }));
  });

  it("skips refresh when session and weekly quotas are above threshold", async () => {
    getProviderConnections.mockResolvedValueOnce([codexGoConnection()]);
    getCodexUsage.mockResolvedValueOnce({ quotas: { session: { remaining: 50 }, weekly: { remaining: 60 } } });

    const { tickCodexGoAutoRefresh } = await import("../../src/shared/services/codexGoAutoRefresh.js");
    await tickCodexGoAutoRefresh({ nowMs: Date.parse("2026-07-07T10:00:00.000Z") });

    expect(refreshCodexGoSession).not.toHaveBeenCalled();
    expect(updateProviderConnection).toHaveBeenCalledWith("conn-1", expect.objectContaining({
      providerSpecificData: expect.objectContaining({
        codexGoRefreshState: expect.objectContaining({
          lastQuotaSnapshot: expect.objectContaining({
            session: expect.objectContaining({ remaining: 50 }),
            weekly: expect.objectContaining({ remaining: 60 }),
          }),
        }),
      }),
    }));
  });

  it("refreshes when weekly quota remaining is at threshold", async () => {
    getProviderConnections.mockResolvedValueOnce([codexGoConnection()]);
    getCodexUsage.mockResolvedValueOnce({ quotas: { session: { remaining: 80 }, weekly: { remaining: 2 } } });
    refreshCodexGoSession.mockResolvedValueOnce(refreshedCredentials());

    const { tickCodexGoAutoRefresh } = await import("../../src/shared/services/codexGoAutoRefresh.js");
    await tickCodexGoAutoRefresh({ nowMs: Date.parse("2026-07-07T10:00:00.000Z") });

    expect(refreshCodexGoSession).toHaveBeenCalledTimes(1);
    expect(updateProviderConnection).toHaveBeenCalledWith("conn-1", expect.objectContaining({
      providerSpecificData: expect.objectContaining({
        codexGoRefreshState: expect.objectContaining({
          lastQuotaSnapshot: expect.objectContaining({
            weekly: expect.objectContaining({ remaining: 2 }),
          }),
        }),
      }),
    }));
  });

  it("skips threshold refresh when hourly limit is exhausted", async () => {
    const nowMs = Date.parse("2026-07-07T10:00:00.000Z");
    getProviderConnections.mockResolvedValueOnce([codexGoConnection({
      providerSpecificData: {
        authMethod: "codexgo",
        codexGoRefreshConfig: { hourlyLimit: 1, autoEnabled: true, thresholdRemainingPercent: 5 },
        codexGoRefreshState: { events: [{ at: "2026-07-07T09:30:00.000Z", reason: "manual" }] },
      },
    })]);
    getCodexUsage.mockResolvedValueOnce({ quotas: { session: { remaining: 1 }, weekly: { remaining: 80 } } });

    const { tickCodexGoAutoRefresh } = await import("../../src/shared/services/codexGoAutoRefresh.js");
    await tickCodexGoAutoRefresh({ nowMs });

    expect(refreshCodexGoSession).not.toHaveBeenCalled();
  });
});

describe("CodexGo 429 auto refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    updateProviderConnection.mockImplementation(async (id, updates) => ({ id, ...updates }));
  });

  it("refreshes a CodexGo account for upstream 429 when auto refresh is enabled", async () => {
    getProviderConnectionById.mockResolvedValueOnce(codexGoConnection());
    refreshCodexGoSession.mockResolvedValueOnce(refreshedCredentials());

    const { tryRefreshCodexGoFor429 } = await import("../../src/lib/oauth/services/codexGoRefreshRuntime.js");
    const result = await tryRefreshCodexGoFor429({
      provider: "codex",
      connectionId: "conn-1",
      status: 429,
      error: "usage_limit_reached",
      nowMs: Date.parse("2026-07-07T10:00:00.000Z"),
    });

    expect(result.refreshed).toBe(true);
    expect(updateProviderConnection).toHaveBeenCalledWith("conn-1", expect.objectContaining({
      accessToken: "new-access",
      providerSpecificData: expect.objectContaining({
        codexGoRefreshState: expect.objectContaining({
          lastRefreshReason: "upstream_429",
          events: [expect.objectContaining({ reason: "upstream_429" })],
        }),
      }),
    }));
  });

  it("refreshes a 429 even when hourly soft limit is exhausted", async () => {
    getProviderConnectionById.mockResolvedValueOnce(codexGoConnection({
      providerSpecificData: {
        authMethod: "codexgo",
        codexGoRefreshConfig: { hourlyLimit: 1, autoEnabled: true, thresholdRemainingPercent: 5 },
        codexGoRefreshState: { events: [{ at: "2026-07-07T09:30:00.000Z", reason: "manual" }] },
      },
    }));
    refreshCodexGoSession.mockResolvedValueOnce(refreshedCredentials());

    const { tryRefreshCodexGoFor429 } = await import("../../src/lib/oauth/services/codexGoRefreshRuntime.js");
    const result = await tryRefreshCodexGoFor429({
      provider: "codex",
      connectionId: "conn-1",
      status: 429,
      error: "usage_limit_reached",
      nowMs: Date.parse("2026-07-07T10:00:00.000Z"),
    });

    expect(result.refreshed).toBe(true);
    expect(result.reason).toBe("upstream_429");
    expect(refreshCodexGoSession).toHaveBeenCalledTimes(1);
    expect(updateProviderConnection).toHaveBeenCalledWith("conn-1", expect.objectContaining({
      providerSpecificData: expect.objectContaining({
        codexGoRefreshState: expect.objectContaining({
          events: [
            expect.objectContaining({ reason: "manual" }),
            expect.objectContaining({ reason: "upstream_429" }),
          ],
          lastRefreshReason: "upstream_429",
        }),
      }),
    }));
  });
});
