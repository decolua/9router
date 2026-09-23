import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  cleanupProviderConnections: vi.fn().mockResolvedValue(undefined),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  getApiKeys: vi.fn().mockResolvedValue([]),
}));

const autoPingMocks = vi.hoisted(() => ({
  startQuotaAutoPing: vi.fn(),
  quotaAutoPingLoaded: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  cleanupProviderConnections: dbMocks.cleanupProviderConnections,
  getSettings: dbMocks.getSettings,
  updateSettings: dbMocks.updateSettings,
  getApiKeys: dbMocks.getApiKeys,
}));

vi.mock("@/lib/tunnel", () => ({
  enableTunnel: vi.fn(),
  enableTailscale: vi.fn(),
  isTunnelManuallyDisabled: vi.fn(),
  isTunnelReconnecting: vi.fn(),
  isTailscaleReconnecting: vi.fn(),
  getTunnelService: vi.fn(() => ({ cancelToken: {}, spawnInProgress: false })),
  getTailscaleService: vi.fn(() => ({ cancelToken: {}, spawnInProgress: false })),
  setTunnelUnexpectedExitCallback: vi.fn(),
  killCloudflared: vi.fn(),
  isCloudflaredRunning: vi.fn().mockReturnValue(true),
  ensureCloudflared: vi.fn().mockResolvedValue(undefined),
  isTailscaleRunning: vi.fn().mockReturnValue(true),
  isTailscaleRunningStrict: vi.fn().mockResolvedValue(true),
  isDaemonAlive: vi.fn().mockReturnValue(true),
  startFunnel: vi.fn(),
  checkInternet: vi.fn().mockResolvedValue(true),
  RESTART_COOLDOWN_MS: 1000,
  NETWORK_SETTLE_MS: 100,
  WATCHDOG_INTERVAL_MS: 60000,
  NETWORK_CHECK_INTERVAL_MS: 10000,
  VIRTUAL_IFACE_REGEX: /dummy/,
}));

vi.mock("@/mitm/manager", () => ({
  getMitmStatus: vi.fn().mockResolvedValue({ running: false }),
  startMitm: vi.fn(),
  loadEncryptedPassword: vi.fn().mockResolvedValue(null),
  initDbHooks: vi.fn(),
  restoreToolDNS: vi.fn(),
  removeAllDNSEntriesSync: vi.fn(),
}));

vi.mock("@/lib/mitmAliasCache", () => ({
  syncToJson: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/mcp/stdioSseBridge", () => ({
  killAllBridges: vi.fn(),
}));

vi.mock("@/sse/services/backgroundTokenRefresh.js", () => ({
  startBackgroundTokenRefresh: vi.fn(),
}));

describe("initializeApp startup auto-ping activation", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    delete global.__appSingleton;
    vi.doMock("@/shared/services/quotaAutoPing", () => {
      autoPingMocks.quotaAutoPingLoaded();
      return {
        startQuotaAutoPing: autoPingMocks.startQuotaAutoPing,
      };
    });
  });

  afterEach(() => {
    if (global.__appSingleton?.watchdogInterval) {
      clearInterval(global.__appSingleton.watchdogInterval);
    }
    if (global.__appSingleton?.networkMonitorInterval) {
      clearInterval(global.__appSingleton.networkMonitorInterval);
    }
    delete global.__appSingleton;
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("never evaluates quotaAutoPing module when importing initializeApp or running disabled startup", async () => {
    vi.resetModules();
    autoPingMocks.quotaAutoPingLoaded.mockClear();
    autoPingMocks.startQuotaAutoPing.mockClear();

    const settings = {
      quotaStaggerGroups: [
        {
          id: "grp-1",
          name: "Disabled Group",
          enabled: false,
          connectionIds: ["cx-1", "cx-2"],
          session: { enabled: true, anchorAt: "2026-01-01T12:00:00.000Z" },
          weekly: { enabled: false, anchorAt: null },
        },
      ],
    };
    dbMocks.getSettings.mockResolvedValue(settings);

    const { initializeApp } = await import("@/shared/services/initializeApp.js");
    expect(autoPingMocks.quotaAutoPingLoaded).not.toHaveBeenCalled();

    await initializeApp();
    await vi.advanceTimersByTimeAsync(3500);

    expect(autoPingMocks.quotaAutoPingLoaded).not.toHaveBeenCalled();
    expect(autoPingMocks.startQuotaAutoPing).not.toHaveBeenCalled();
  });

  it.each([
    ["legacy claudeAutoPing", { claudeAutoPing: { connections: { "cx-1": true } } }],
    ["legacy codexAutoPing", { codexAutoPing: { connections: { "cx-2": true } } }],
    ["stagger group", {
      quotaStaggerGroups: [
        {
          id: "grp-1",
          name: "Stagger Group",
          enabled: true,
          connectionIds: ["cx-1", "cx-2"],
          session: { enabled: true, anchorAt: "2026-01-01T12:00:00.000Z" },
          weekly: { enabled: false, anchorAt: null },
        },
      ],
    }],
  ])("evaluates quotaAutoPing module and starts scheduler only after defer when %s is enabled", async (_, settings) => {
    vi.resetModules();
    autoPingMocks.quotaAutoPingLoaded.mockClear();
    autoPingMocks.startQuotaAutoPing.mockClear();

    dbMocks.getSettings.mockResolvedValue(settings);

    const { initializeApp } = await import("@/shared/services/initializeApp.js");
    expect(autoPingMocks.quotaAutoPingLoaded).not.toHaveBeenCalled();

    await initializeApp();
    expect(autoPingMocks.quotaAutoPingLoaded).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2000);
    expect(autoPingMocks.quotaAutoPingLoaded).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1500);
    await vi.waitFor(() => {
      expect(autoPingMocks.quotaAutoPingLoaded).toHaveBeenCalledTimes(1);
      expect(autoPingMocks.startQuotaAutoPing).toHaveBeenCalledTimes(1);
    });
  });
});
