import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getConnectionStatusPresentation,
  getConnectionStatusReasonLabel,
  getDashboardConnectionStatus,
  getStatusDisplayItems,
} from "../../src/app/(dashboard)/dashboard/providers/statusDisplay.js";

const providerConnections = [];
const providerNodes = [];

const getProviderConnections = vi.fn(async () => providerConnections);
const getProviderNodes = vi.fn(async () => providerNodes);
const getConnectionStatusSummary = vi.fn(() => ({
  connected: 0,
  error: 0,
  unknown: 0,
  total: 0,
  allDisabled: false,
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    }),
  },
}));

vi.mock("@/models", () => ({
  getProviderConnections,
  createProviderConnection: vi.fn(),
  getProviderNodeById: vi.fn(async () => null),
  getProviderNodes,
  getProxyPoolById: vi.fn(async () => null),
}));

vi.mock("@/shared/constants/config", () => ({
  APIKEY_PROVIDERS: {},
}));

vi.mock("@/shared/constants/providers", () => ({
  FREE_TIER_PROVIDERS: {},
  WEB_COOKIE_PROVIDERS: {},
  isOpenAICompatibleProvider: () => false,
  isAnthropicCompatibleProvider: () => false,
}));

const updateProviderConnection = vi.fn(async () => null);

vi.mock("@/lib/localDb", () => ({
  getProviderConnections,
  updateProviderConnection,
  getConnectionStatusSummary,
}));

beforeEach(() => {
  providerConnections.length = 0;
  providerNodes.length = 0;
  getProviderConnections.mockClear();
  getProviderNodes.mockClear();
  updateProviderConnection.mockClear();
  getConnectionStatusSummary.mockClear();
  getProviderConnections.mockResolvedValue(providerConnections);
  getProviderNodes.mockResolvedValue(providerNodes);
  getConnectionStatusSummary.mockReturnValue({
    connected: 0,
    error: 0,
    unknown: 0,
    total: 0,
    allDisabled: false,
  });
});

describe("providers page status display", () => {
  it("treats legacy testStatus-only rows as unknown on dashboard surfaces", () => {
    expect(getDashboardConnectionStatus({ testStatus: "active" })).toBe("unknown");
    expect(getDashboardConnectionStatus({ testStatus: "unavailable" })).toBe("unknown");
  });

  it("keeps canonical status when canonical fields are present", () => {
    expect(getDashboardConnectionStatus({ routingStatus: "eligible" })).toBe("eligible");
    expect(getDashboardConnectionStatus({ authState: "expired" })).toBe("blocked");
    expect(getDashboardConnectionStatus({ quotaState: "blocked" })).toBe("exhausted");
    expect(getDashboardConnectionStatus({ quotaState: "cooldown" })).toBe("unknown");
  });

  it("builds provider row reason labels from canonical fields with approved precedence", () => {
    expect(getConnectionStatusReasonLabel({
      isActive: false,
      authState: "invalid",
      healthStatus: "down",
      quotaState: "blocked",
      routingStatus: "blocked",
      reasonCode: "auth_invalid",
      reasonDetail: "token revoked",
    })).toBe("manually disabled");

    expect(getConnectionStatusReasonLabel({
      isActive: true,
      authState: "invalid",
      healthStatus: "down",
      quotaState: "blocked",
      routingStatus: "blocked",
      reasonCode: "quota_exhausted",
      reasonDetail: "quota exceeded",
    })).toBe("auth: invalid");

    expect(getConnectionStatusReasonLabel({
      isActive: true,
      healthStatus: "down",
      quotaState: "blocked",
      routingStatus: "blocked",
      reasonCode: "quota_exhausted",
    })).toBe("health: down");

    expect(getConnectionStatusReasonLabel({
      isActive: true,
      quotaState: "blocked",
      routingStatus: "blocked",
      reasonCode: "auth_invalid",
    })).toBe("quota: blocked");

    expect(getConnectionStatusReasonLabel({
      isActive: true,
      routingStatus: "blocked",
      reasonCode: "auth_invalid",
    })).toBe("routing: blocked");

    expect(getConnectionStatusReasonLabel({
      isActive: true,
      reasonCode: "quota_exhausted",
      reasonDetail: "Token revoked by upstream",
    })).toBe("quota exhausted");

    expect(getConnectionStatusReasonLabel({
      isActive: true,
      reasonDetail: "Token revoked by upstream",
    })).toBe("Token revoked by upstream");
  });

  it("does not expose or depend on status source labels for provider row reasons", () => {
    expect(getConnectionStatusReasonLabel({
      testStatus: "unavailable",
      source: "legacy-testStatus",
      reasonCode: "quota_exhausted",
      reasonDetail: "quota exceeded",
    })).toBe("quota exhausted");

    expect(getConnectionStatusReasonLabel({
      source: "legacy-unavailable-cooldown",
      reasonDetail: "Upstream timeout",
    })).toBe("Upstream timeout");
  });

  it("centralizes provider row badge and reason presentation from one helper", () => {
    expect(getConnectionStatusPresentation({ authState: "revoked" })).toMatchObject({
      badge: { status: "blocked", label: "Blocked", variant: "error" },
      reasonLabel: "auth: revoked",
    });

    expect(getConnectionStatusPresentation({ quotaState: "blocked", nextRetryAt: "2099-01-01T00:00:00.000Z" })).toMatchObject({
      badge: { status: "exhausted", label: "Exhausted", variant: "warning" },
    });
    expect(getConnectionStatusPresentation({ quotaState: "blocked", nextRetryAt: "2099-01-01T00:00:00.000Z" }).reasonLabel).toContain("quota: blocked · retry ");
  });

  it("availability api uses canonical reason detail without legacy lastError fallback", async () => {
    providerConnections.push({
      id: "c1",
      provider: "codex",
      authType: "oauth",
      routingStatus: "unknown",
      modelLock_gpt4: "2099-01-01T00:00:00.000Z",
      lastError: "legacy outage",
      reasonDetail: null,
      isActive: true,
    });

    const { GET } = await import("../../src/app/api/models/availability/route.js");
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.body.models).toEqual([
      expect.objectContaining({
        provider: "codex",
        model: "gpt4",
        status: "cooldown",
        lastError: null,
      }),
    ]);
  });

  it("availability clear-all canonical precedence includes timed cooldowns, provider-wide statuses, and model locks", async () => {
    providerConnections.push(
      {
        id: "timed",
        provider: "codex",
        authType: "oauth",
        routingStatus: "unknown",
        nextRetryAt: "2099-01-01T00:00:00.000Z",
        isActive: true,
      },
      {
        id: "blocked-route",
        provider: "codex",
        authType: "oauth",
        routingStatus: "blocked",
        quotaState: "ok",
        isActive: true,
      },
      {
        id: "blocked-quota",
        provider: "codex",
        authType: "oauth",
        routingStatus: "unknown",
        quotaState: "blocked",
        isActive: true,
      },
      {
        id: "lock-only",
        provider: "codex",
        authType: "oauth",
        routingStatus: "unknown",
        modelLock_gpt4: "2099-01-01T00:00:00.000Z",
        isActive: true,
      },
    );

    const { POST } = await import("../../src/app/api/models/availability/route.js");
    const response = await POST(new Request("http://localhost/api/models/availability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clearCooldown", provider: "codex", model: "__all" }),
    }));

    expect(response.status).toBe(200);
    expect(updateProviderConnection).toHaveBeenCalledTimes(4);
    expect(updateProviderConnection).toHaveBeenCalledWith("timed", expect.objectContaining({
      nextRetryAt: null,
      resetAt: null,
    }));
    expect(updateProviderConnection).toHaveBeenCalledWith("blocked-route", expect.objectContaining({
      routingStatus: null,
      nextRetryAt: null,
      resetAt: null,
    }));
    expect(updateProviderConnection).toHaveBeenCalledWith("blocked-quota", expect.objectContaining({
      quotaState: null,
      nextRetryAt: null,
      resetAt: null,
    }));
    expect(updateProviderConnection).toHaveBeenCalledWith("lock-only", expect.objectContaining({
      modelLock_gpt4: null,
      nextRetryAt: null,
      resetAt: null,
    }));
  });

  it("availability clear-all ignores unknown provider status without canonical clearable signals", async () => {
    providerConnections.push({
      id: "unknown-only",
      provider: "codex",
      authType: "oauth",
      routingStatus: "unknown",
      quotaState: "ok",
      authState: "ok",
      healthStatus: "healthy",
      isActive: true,
    });

    const { POST } = await import("../../src/app/api/models/availability/route.js");
    const response = await POST(new Request("http://localhost/api/models/availability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clearCooldown", provider: "codex", model: "__all" }),
    }));

    expect(response.status).toBe(200);
    expect(updateProviderConnection).not.toHaveBeenCalled();
  });

  it("does not count legacy unavailable records as provider errors", () => {
    const providerConnections = [
      { testStatus: "unavailable", lastErrorAt: "2026-04-22T00:00:00.000Z" },
      { routingStatus: "eligible" },
    ];

    const connected = providerConnections.filter((c) => getDashboardConnectionStatus(c) === "eligible").length;
    const error = providerConnections.filter((c) => {
      const status = getDashboardConnectionStatus(c);
      return status === "blocked" || status === "exhausted";
    }).length;

    expect(connected).toBe(1);
    expect(error).toBe(0);
    expect(getStatusDisplayItems(connected, error, providerConnections.length, null)).toEqual([
      { key: "connected", variant: "success", dot: true, label: "1 Connected" },
    ]);
  });

  it("shows connected and error badges with canonical error tag", () => {
    const display = getStatusDisplayItems(2, 1, 3, "AUTH");
    expect(display).toEqual([
      { key: "connected", variant: "success", dot: true, label: "2 Connected" },
      { key: "error", variant: "error", dot: true, label: "1 Error (AUTH)" },
    ]);
  });

  it("shows saved badge when provider has saved connections but no eligible or error accounts", () => {
    const display = getStatusDisplayItems(0, 0, 3, null);
    expect(display).toEqual([
      { key: "saved", variant: "default", dot: false, label: "3 Saved" },
    ]);
  });

  it("api provider summaries treat legacy-only statuses as unknown", async () => {
    getConnectionStatusSummary.mockReturnValue({
      connected: 1,
      error: 1,
      unknown: 1,
      total: 3,
      allDisabled: false,
    });

    providerConnections.push(
      { id: "c1", provider: "codex", authType: "oauth", testStatus: "unavailable", isActive: true },
      { id: "c2", provider: "codex", authType: "oauth", routingStatus: "eligible", isActive: true },
      { id: "c3", provider: "codex", authType: "oauth", authState: "expired", isActive: true },
    );

    const { GET } = await import("../../src/app/api/providers/route.js");
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.body.providerSummaries).toMatchObject({
      codex: {
        oauth: {
          connected: 1,
          error: 1,
          unknown: 1,
          total: 3,
        },
      },
    });
    expect(getConnectionStatusSummary).toHaveBeenCalledWith(providerConnections);
  });
});
