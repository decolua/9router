import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cleanupProviderConnections = vi.fn(async () => {});
const getSettings = vi.fn(async () => ({
  tunnelEnabled: false,
  mitmEnabled: false,
  quotaScheduler: {
    enabled: false,
    cadenceMs: 300000,
    successTtlMs: 900000,
    errorTtlMs: 300000,
    exhaustedTtlMs: 60000,
    batchSize: 25,
  },
}));
const updateSettings = vi.fn(async () => ({}));
const getApiKeys = vi.fn(async () => []);
const schedulerStart = vi.fn(async () => {});

vi.mock("@/lib/localDb", () => ({
  cleanupProviderConnections,
  getSettings,
  updateSettings,
  getApiKeys,
}));

vi.mock("@/lib/quotaRefreshPlanner", () => ({
  normalizeQuotaSchedulerSettings: (settings = {}) => ({
    enabled: settings.enabled ?? false,
    cadenceMs: settings.cadenceMs ?? 300000,
    successTtlMs: settings.successTtlMs ?? 900000,
    errorTtlMs: settings.errorTtlMs ?? 300000,
    exhaustedTtlMs: settings.exhaustedTtlMs ?? 60000,
    batchSize: settings.batchSize ?? 25,
  }),
}));

vi.mock("@/lib/quotaRefreshState", async () => vi.importActual("../../src/lib/quotaRefreshState.js"));

vi.mock("@/lib/tunnel/tunnelManager", () => ({
  enableTunnel: vi.fn(async () => {}),
  isTunnelManuallyDisabled: vi.fn(() => false),
  isTunnelReconnecting: vi.fn(() => false),
}));

vi.mock("@/lib/tunnel/cloudflared", () => ({
  killCloudflared: vi.fn(() => {}),
  isCloudflaredRunning: vi.fn(() => false),
  ensureCloudflared: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/mitm/manager", () => ({
  getMitmStatus: vi.fn(async () => ({ running: false })),
  startMitm: vi.fn(async () => {}),
  loadEncryptedPassword: vi.fn(async () => "saved-password"),
  initDbHooks: vi.fn(() => {}),
}));

describe("quotaRefreshScheduler", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.doUnmock("@/lib/quotaRefreshScheduler");
    delete global.__appSingleton;
  });

  afterEach(() => {
    delete global.__appSingleton;
  });

  it("schedules a single scaffold timer when enabled", async () => {
    const unref = vi.fn();
    const setTimeoutFn = vi.fn((fn, delay) => ({ fn, delay, unref }));
    const clearTimeoutFn = vi.fn();

    const { QuotaRefreshScheduler } = await import("../../src/lib/quotaRefreshScheduler.js");
    const scheduler = new QuotaRefreshScheduler({
      getSettingsFn: async () => ({
        quotaScheduler: {
          enabled: true,
          cadenceMs: 5000,
          successTtlMs: 900000,
          errorTtlMs: 300000,
          exhaustedTtlMs: 60000,
          batchSize: 25,
        },
      }),
      setTimeoutFn,
      clearTimeoutFn,
      now: () => new Date("2026-04-21T12:00:00.000Z"),
    });

    await scheduler.start();
    await scheduler.start();

    expect(setTimeoutFn).toHaveBeenCalledTimes(1);
    expect(setTimeoutFn).toHaveBeenCalledWith(expect.any(Function), 5000);
    expect(unref).toHaveBeenCalledTimes(1);
    expect(scheduler.getStateSnapshot()).toMatchObject({
      status: "idle",
      nextScheduledAt: "2026-04-21T12:00:05.000Z",
    });
  });

  it("allows retrying start after startup scheduling failure", async () => {
    const setTimeoutFn = vi.fn((fn, delay) => ({ fn, delay }));
    const clearTimeoutFn = vi.fn();
    const getSettingsFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("startup failed"))
      .mockResolvedValueOnce({
        quotaScheduler: {
          enabled: true,
          cadenceMs: 5000,
          successTtlMs: 900000,
          errorTtlMs: 300000,
          exhaustedTtlMs: 60000,
          batchSize: 25,
        },
      });

    const { QuotaRefreshScheduler } = await import("../../src/lib/quotaRefreshScheduler.js");
    const scheduler = new QuotaRefreshScheduler({
      getSettingsFn,
      setTimeoutFn,
      clearTimeoutFn,
      now: () => new Date("2026-04-21T12:00:00.000Z"),
    });

    await expect(scheduler.start()).rejects.toThrow("startup failed");
    expect(scheduler.isStarted()).toBe(false);
    expect(clearTimeoutFn).not.toHaveBeenCalled();
    expect(setTimeoutFn).not.toHaveBeenCalled();

    await expect(scheduler.start()).resolves.toBe(scheduler);
    expect(scheduler.isStarted()).toBe(true);
    expect(setTimeoutFn).toHaveBeenCalledTimes(1);
    expect(setTimeoutFn).toHaveBeenCalledWith(expect.any(Function), 5000);
    expect(scheduler.getStateSnapshot()).toMatchObject({
      status: "idle",
      nextScheduledAt: "2026-04-21T12:00:05.000Z",
    });
  });

  it("reuses a global singleton across repeated calls", async () => {
    const { getQuotaRefreshScheduler } = await import("../../src/lib/quotaRefreshScheduler.js");

    const first = getQuotaRefreshScheduler({ getSettingsFn: async () => ({ quotaScheduler: { enabled: false } }) });
    const second = getQuotaRefreshScheduler({ getSettingsFn: async () => ({ quotaScheduler: { enabled: true } }) });

    expect(second).toBe(first);
  });

  it("returns enriched status snapshots with scheduler metadata", async () => {
    const { QuotaRefreshScheduler } = await import("../../src/lib/quotaRefreshScheduler.js");
    const scheduler = new QuotaRefreshScheduler({
      getSettingsFn: async () => ({
        quotaScheduler: {
          enabled: true,
          cadenceMs: 5000,
          successTtlMs: 900000,
          errorTtlMs: 300000,
          exhaustedTtlMs: 60000,
          batchSize: 25,
        },
      }),
      setTimeoutFn: vi.fn(() => ({ unref: vi.fn() })),
      clearTimeoutFn: vi.fn(),
      now: () => new Date("2026-04-21T12:00:00.000Z"),
    });

    await scheduler.start();

    await expect(scheduler.getStatusSnapshot({ refreshSettings: true })).resolves.toMatchObject({
      started: true,
      enabled: true,
      hasScheduledTimer: true,
      settings: expect.objectContaining({
        cadenceMs: 5000,
        enabled: true,
      }),
      nextScheduledAt: "2026-04-21T12:00:05.000Z",
    });
  });

  it("rejects manual run requests when the scheduler is disabled", async () => {
    const { QuotaRefreshScheduler } = await import("../../src/lib/quotaRefreshScheduler.js");
    const scheduler = new QuotaRefreshScheduler({
      getSettingsFn: async () => ({ quotaScheduler: { enabled: false } }),
      setTimeoutFn: vi.fn(),
      clearTimeoutFn: vi.fn(),
      now: () => new Date("2026-04-21T12:00:00.000Z"),
    });

    await expect(scheduler.requestManualRun("api")).resolves.toMatchObject({
      accepted: false,
      reason: "scheduler_disabled",
      snapshot: expect.objectContaining({
        started: false,
        enabled: false,
        nextScheduledAt: null,
      }),
    });
  });

  it("runs scaffold work immediately for manual run requests", async () => {
    const setTimeoutFn = vi.fn(() => ({ unref: vi.fn() }));
    const clearTimeoutFn = vi.fn();

    const { QuotaRefreshScheduler } = await import("../../src/lib/quotaRefreshScheduler.js");
    const scheduler = new QuotaRefreshScheduler({
      getSettingsFn: async () => ({
        quotaScheduler: {
          enabled: true,
          cadenceMs: 5000,
          successTtlMs: 900000,
          errorTtlMs: 300000,
          exhaustedTtlMs: 60000,
          batchSize: 25,
        },
      }),
      setTimeoutFn,
      clearTimeoutFn,
      now: () => new Date("2026-04-21T12:00:00.000Z"),
    });

    await expect(scheduler.requestManualRun("api")).resolves.toMatchObject({
      accepted: true,
      reason: "run_triggered",
      snapshot: expect.objectContaining({
        started: true,
        enabled: true,
        restartRequested: false,
        lastRun: expect.objectContaining({
          trigger: "api",
          result: expect.objectContaining({
            outcome: "scaffold_only",
          }),
        }),
        nextScheduledAt: "2026-04-21T12:00:05.000Z",
      }),
    });
    expect(setTimeoutFn).toHaveBeenCalledTimes(2);
    expect(clearTimeoutFn).toHaveBeenCalledTimes(1);
  });

  it("requests a restart instead of overlapping an active run", async () => {
    const setTimeoutFn = vi.fn(() => ({ unref: vi.fn() }));
    const clearTimeoutFn = vi.fn();

    const { QuotaRefreshScheduler } = await import("../../src/lib/quotaRefreshScheduler.js");
    const scheduler = new QuotaRefreshScheduler({
      getSettingsFn: async () => ({
        quotaScheduler: {
          enabled: true,
          cadenceMs: 5000,
          successTtlMs: 900000,
          errorTtlMs: 300000,
          exhaustedTtlMs: 60000,
          batchSize: 25,
        },
      }),
      setTimeoutFn,
      clearTimeoutFn,
      now: () => new Date("2026-04-21T12:00:00.000Z"),
    });

    await scheduler.start();
    scheduler.state.startRun({
      trigger: "timer",
      metadata: { scaffoldOnly: true },
    });

    await expect(scheduler.requestManualRun("api")).resolves.toMatchObject({
      accepted: true,
      reason: "restart_requested",
      snapshot: expect.objectContaining({
        started: true,
        enabled: true,
        restartRequested: true,
        currentRun: expect.objectContaining({
          restartReason: "api",
        }),
      }),
    });

    expect(clearTimeoutFn).toHaveBeenCalledTimes(1);
    expect(setTimeoutFn).toHaveBeenCalledTimes(2);
  });

  it("honors a pending restart after the active scaffold run completes", async () => {
    const setTimeoutFn = vi.fn(() => ({ unref: vi.fn() }));
    const clearTimeoutFn = vi.fn();

    const { QuotaRefreshScheduler } = await import("../../src/lib/quotaRefreshScheduler.js");
    const scheduler = new QuotaRefreshScheduler({
      getSettingsFn: async () => ({
        quotaScheduler: {
          enabled: true,
          cadenceMs: 5000,
          successTtlMs: 900000,
          errorTtlMs: 300000,
          exhaustedTtlMs: 60000,
          batchSize: 25,
        },
      }),
      setTimeoutFn,
      clearTimeoutFn,
      now: () => new Date("2026-04-21T12:00:00.000Z"),
    });

    await scheduler.start();

    const startRunSpy = vi.spyOn(scheduler.state, "startRun");
    const originalFinishRun = scheduler.state.finishRun.bind(scheduler.state);
    let injectedRestart = false;

    scheduler.state.finishRun = vi.fn((result) => {
      if (!injectedRestart) {
        injectedRestart = true;
        scheduler.state.requestRestart("api");
      }

      return originalFinishRun(result);
    });

    const snapshot = await scheduler.runScaffold("timer");

    expect(startRunSpy).toHaveBeenCalledTimes(2);
    expect(snapshot).toMatchObject({
      restartRequested: false,
      lastRun: expect.objectContaining({
        trigger: "api",
        result: expect.objectContaining({
          outcome: "scaffold_only",
        }),
      }),
      nextScheduledAt: "2026-04-21T12:00:05.000Z",
    });
  });

  it("wires scheduler startup into initializeApp", async () => {
    const getQuotaRefreshScheduler = vi.fn(() => ({ start: schedulerStart }));
    vi.doMock("@/lib/quotaRefreshScheduler", () => ({
      getQuotaRefreshScheduler,
    }));

    const { initializeApp } = await import("../../src/shared/services/initializeApp.js");

    await initializeApp();

    expect(cleanupProviderConnections).toHaveBeenCalledTimes(1);
    expect(getQuotaRefreshScheduler).toHaveBeenCalledTimes(1);
    expect(schedulerStart).toHaveBeenCalledTimes(1);
  });
});
