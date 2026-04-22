import { beforeEach, describe, expect, it, vi } from "vitest";

const getStatusSnapshot = vi.fn();
const requestManualRun = vi.fn();
const refreshSchedule = vi.fn();
const getQuotaRefreshScheduler = vi.fn(() => ({
  getStatusSnapshot,
  requestManualRun,
  refreshSchedule,
}));

const getSettings = vi.fn(async () => ({}));
const updateSettings = vi.fn(async (updates) => updates);

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    }),
  },
}));

vi.mock("@/lib/quotaRefreshScheduler", () => ({
  getQuotaRefreshScheduler,
}));

vi.mock("@/lib/localDb", () => ({
  getSettings,
  updateSettings,
}));

vi.mock("@/lib/network/outboundProxy", () => ({
  applyOutboundProxyEnv: vi.fn(),
}));

vi.mock("@/lib/runtimeConfig", () => ({
  readRuntimeConfig: vi.fn(async () => ({ redis: {} })),
}));

vi.mock("bcryptjs", () => ({
  default: {
    compare: vi.fn(async () => true),
    genSalt: vi.fn(async () => "salt"),
    hash: vi.fn(async () => "hashed"),
  },
}));

describe("quota refresh api routes", () => {
  beforeEach(() => {
    vi.resetModules();
    getQuotaRefreshScheduler.mockClear();
    getStatusSnapshot.mockReset();
    requestManualRun.mockReset();
    refreshSchedule.mockReset();
    getSettings.mockReset();
    updateSettings.mockReset();
  });

  it("returns the current scheduler status snapshot", async () => {
    getStatusSnapshot.mockResolvedValueOnce({
      started: true,
      enabled: true,
      status: "idle",
      nextScheduledAt: "2026-04-21T12:00:05.000Z",
    });

    const { GET } = await import("../../src/app/api/quota-refresh/status/route.js");
    const response = await GET();

    expect(response.status).toBe(200);
    expect(getQuotaRefreshScheduler).toHaveBeenCalledTimes(1);
    expect(getStatusSnapshot).toHaveBeenCalledWith({ refreshSettings: true });
    expect(response.body).toMatchObject({
      started: true,
      enabled: true,
      status: "idle",
    });
  });

  it("returns success when a manual run is triggered immediately", async () => {
    requestManualRun.mockResolvedValueOnce({
      accepted: true,
      reason: "run_triggered",
      snapshot: { started: true, restartRequested: false },
    });

    const { POST } = await import("../../src/app/api/quota-refresh/run/route.js");
    const response = await POST(new Request("http://localhost/api/quota-refresh/run", {
      method: "POST",
      body: JSON.stringify({ reason: "manual_test" }),
      headers: { "content-type": "application/json" },
    }));

    expect(response.status).toBe(200);
    expect(requestManualRun).toHaveBeenCalledWith("manual_test");
    expect(response.body).toMatchObject({
      accepted: true,
      reason: "run_triggered",
    });
  });

  it("returns accepted when a restart is requested for an active run", async () => {
    requestManualRun.mockResolvedValueOnce({
      accepted: true,
      reason: "restart_requested",
      snapshot: { started: true, restartRequested: true },
    });

    const { POST } = await import("../../src/app/api/quota-refresh/run/route.js");
    const response = await POST(new Request("http://localhost/api/quota-refresh/run", {
      method: "POST",
      body: JSON.stringify({ reason: "manual_test" }),
      headers: { "content-type": "application/json" },
    }));

    expect(response.status).toBe(202);
    expect(requestManualRun).toHaveBeenCalledWith("manual_test");
    expect(response.body).toMatchObject({
      accepted: true,
      reason: "restart_requested",
    });
  });

  it("returns conflict when manual run is requested while disabled", async () => {
    requestManualRun.mockResolvedValueOnce({
      accepted: false,
      reason: "scheduler_disabled",
      snapshot: { started: false, enabled: false },
    });

    const { POST } = await import("../../src/app/api/quota-refresh/run/route.js");
    const response = await POST(new Request("http://localhost/api/quota-refresh/run", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
    }));

    expect(response.status).toBe(409);
    expect(requestManualRun).toHaveBeenCalledWith("manual_api");
    expect(response.body).toMatchObject({
      accepted: false,
      reason: "scheduler_disabled",
    });
  });

  it("reschedules the live quota refresh scheduler after quota settings updates", async () => {
    updateSettings.mockResolvedValueOnce({
      quotaScheduler: {
        enabled: true,
        cadenceMs: 15000,
        successTtlMs: 900000,
        errorTtlMs: 300000,
        exhaustedTtlMs: 60000,
        batchSize: 10,
      },
    });
    refreshSchedule.mockResolvedValueOnce({ started: true, enabled: true });

    const { PATCH } = await import("../../src/app/api/settings/route.js");
    const response = await PATCH(new Request("http://localhost/api/settings", {
      method: "PATCH",
      body: JSON.stringify({
        quotaScheduler: {
          enabled: true,
          cadenceMs: 15000,
          batchSize: 10,
        },
      }),
      headers: { "content-type": "application/json" },
    }));

    expect(response.status).toBe(200);
    expect(updateSettings).toHaveBeenCalledWith({
      quotaScheduler: {
        enabled: true,
        cadenceMs: 15000,
        batchSize: 10,
      },
    });
    expect(getQuotaRefreshScheduler).toHaveBeenCalledTimes(1);
    expect(refreshSchedule).toHaveBeenCalledWith("settings_update");
  });
});
