import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({
  cleanupProviderConnections: vi.fn(async () => {}),
  getSettings: vi.fn(async () => ({})),
  updateSettings: vi.fn(async () => {}),
  getApiKeys: vi.fn(async () => []),
}));

vi.mock("@/lib/tunnel", () => ({
  enableTunnel: vi.fn(async () => {}),
  enableTailscale: vi.fn(async () => {}),
  isTunnelManuallyDisabled: vi.fn(() => false),
  isTunnelReconnecting: vi.fn(() => false),
  isTailscaleReconnecting: vi.fn(() => false),
  getTunnelService: vi.fn(() => ({ cancelToken: {}, spawnInProgress: false, lastRestartAt: 0 })),
  getTailscaleService: vi.fn(() => ({ cancelToken: {}, spawnInProgress: false, activeLocalPort: null, lastRestartAt: 0 })),
  setTunnelUnexpectedExitCallback: vi.fn(),
  killCloudflared: vi.fn(),
  isCloudflaredRunning: vi.fn(() => false),
  ensureCloudflared: vi.fn(async () => {}),
  isTailscaleRunning: vi.fn(() => false),
  isTailscaleRunningStrict: vi.fn(async () => false),
  isDaemonAlive: vi.fn(() => false),
  startFunnel: vi.fn(async () => {}),
  checkInternet: vi.fn(async () => true),
  RESTART_COOLDOWN_MS: 0,
  NETWORK_SETTLE_MS: 0,
  WATCHDOG_INTERVAL_MS: 1000,
  NETWORK_CHECK_INTERVAL_MS: 1000,
  VIRTUAL_IFACE_REGEX: /^$/,
}));

vi.mock("@/mitm/manager", () => ({
  getMitmStatus: vi.fn(async () => ({ running: false })),
  startMitm: vi.fn(async () => {}),
  loadEncryptedPassword: vi.fn(async () => null),
  initDbHooks: vi.fn(),
  restoreToolDNS: vi.fn(async () => {}),
  removeAllDNSEntriesSync: vi.fn(),
}));

vi.mock("@/lib/mitmAliasCache", () => ({ syncToJson: vi.fn(async () => {}) }));
vi.mock("@/lib/mcp/stdioSseBridge", () => ({ killAllBridges: vi.fn() }));

const { initializeApp } = await import("@/shared/services/initializeApp.js");
const { ShutdownPhase, __test__: coord } = await import("@/lib/runtime/shutdownCoordinator.js");

describe("initializeApp shutdown delegation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    coord.reset();
    global.__appSingleton = undefined;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    coord.reset();
    global.__appSingleton = undefined;
  });

  it("registers one app cleanup step at the CLEANUP phase", async () => {
    await initializeApp();

    const step = coord.snapshot().find((entry) => entry.name === "app-runtime-cleanup");
    expect(step).toBeDefined();
    expect(step.phase).toBe(ShutdownPhase.CLEANUP);
  });

  it("installs exactly one coordinator signal listener and stays idempotent", async () => {
    const before = process.listeners("SIGINT").length;

    await initializeApp();
    const afterFirst = process.listeners("SIGINT").length;
    await initializeApp();
    const afterSecond = process.listeners("SIGINT").length;

    expect(afterFirst - before).toBe(1);
    expect(afterSecond).toBe(afterFirst);
    expect(coord.snapshot().filter((entry) => entry.name === "app-runtime-cleanup")).toHaveLength(1);
  });

  it("does not own a raw SIGINT/SIGTERM handler that exits immediately", () => {
    const rawNames = ["SIGINT", "SIGTERM"]
      .flatMap((event) => process.listeners(event).map((fn) => fn.name));
    expect(rawNames).not.toContain("cleanup");
  });
});
