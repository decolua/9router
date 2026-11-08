// Task 13 startup regression: the Node server must start the app lifecycle
// without a dashboard page render. Parent executes this in the approved sandbox.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ENV_KEYS = ["NEXT_RUNTIME", "NEXT_PHASE"];
const SIGNALS = ["SIGINT", "SIGTERM", "exit"];
const MOCKED = [
  "@/lib/consoleLogBuffer",
  "open-sse/providers/catalogOverride.js",
  "@/lib/modelCatalog/sync.js",
  "@/lib/localDb",
  "@/lib/tunnel",
  "@/mitm/manager",
  "@/lib/mitmAliasCache",
  "@/lib/mcp/stdioSseBridge",
  "@/sse/services/backgroundTokenRefresh.js",
  "@/lib/webhooks/dispatcher.js",
];

function installMocks(record = () => {}) {
  const startWebhookDispatcher = vi.fn(() => record("scheduler"));
  const getSettings = vi.fn(async () => {
    record("settings");
    return {};
  });
  const cleanupProviderConnections = vi.fn(async () => {
    record("cleanup");
  });
  vi.doMock("@/lib/consoleLogBuffer", () => ({ initConsoleLogCapture: vi.fn() }));
  vi.doMock("open-sse/providers/catalogOverride.js", () => ({
    installCatalogSource: vi.fn(async () => {}),
  }));
  vi.doMock("@/lib/modelCatalog/sync.js", () => ({ startModelCatalogSync: vi.fn() }));
  vi.doMock("@/lib/localDb", () => ({
    cleanupProviderConnections,
    getSettings,
    updateSettings: vi.fn(async () => {}),
    getApiKeys: vi.fn(async () => []),
  }));
  vi.doMock("@/lib/tunnel", () => ({
    enableTunnel: vi.fn(),
    enableTailscale: vi.fn(),
    isTunnelManuallyDisabled: () => false,
    isTunnelReconnecting: () => false,
    isTailscaleReconnecting: () => false,
    getTunnelService: vi.fn(),
    getTailscaleService: vi.fn(),
    setTunnelUnexpectedExitCallback: vi.fn(),
    killCloudflared: vi.fn(),
    isCloudflaredRunning: () => false,
    ensureCloudflared: vi.fn(),
    isTailscaleRunning: () => false,
    isTailscaleRunningStrict: () => false,
    isDaemonAlive: () => false,
    startFunnel: vi.fn(),
    checkInternet: async () => false,
    RESTART_COOLDOWN_MS: 60_000,
    NETWORK_SETTLE_MS: 1000,
    WATCHDOG_INTERVAL_MS: 60_000,
    NETWORK_CHECK_INTERVAL_MS: 60_000,
    VIRTUAL_IFACE_REGEX: /^dummy$/,
  }));
  vi.doMock("@/mitm/manager", () => ({
    getMitmStatus: vi.fn(),
    startMitm: vi.fn(),
    loadEncryptedPassword: vi.fn(),
    initDbHooks: vi.fn(),
    restoreToolDNS: vi.fn(),
    removeAllDNSEntriesSync: vi.fn(),
  }));
  vi.doMock("@/lib/mitmAliasCache", () => ({ syncToJson: vi.fn() }));
  vi.doMock("@/lib/mcp/stdioSseBridge", () => ({ killAllBridges: vi.fn() }));
  vi.doMock("@/sse/services/backgroundTokenRefresh.js", () => ({
    startBackgroundTokenRefresh: vi.fn(),
  }));
  vi.doMock("@/lib/webhooks/dispatcher.js", () => ({
    startWebhookDispatcher,
    stopWebhookDispatcher: vi.fn(),
  }));
  return { startWebhookDispatcher, getSettings, cleanupProviderConnections };
}

async function runRegister() {
  const { register } = await import("@/instrumentation.js");
  return register();
}

describe("webhook dispatcher startup from the Node server hook", () => {
  let savedEnv;
  let savedMaxListeners;
  let listenersBefore;

  beforeEach(() => {
    vi.resetModules();
    savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    savedMaxListeners = process.getMaxListeners();
    listenersBefore = new Map(SIGNALS.map((signal) => [signal, new Set(process.listeners(signal))]));
    delete global.__appBootstrapped;
    delete global.__appSingleton;
    delete global._webhookDispatcher;
  });

  afterEach(() => {
    for (const moduleId of MOCKED) vi.doUnmock(moduleId);
    vi.useRealTimers();
    vi.resetModules();
    for (const [signal, before] of listenersBefore) {
      for (const listener of process.listeners(signal)) {
        if (!before.has(listener)) process.removeListener(signal, listener);
      }
    }
    process.setMaxListeners(savedMaxListeners);
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    delete global.__appBootstrapped;
    delete global.__appSingleton;
    delete global._webhookDispatcher;
  });

  it("register starts settings-ranked app lifecycle without a page render", async () => {
    const order = [];
    const { startWebhookDispatcher, getSettings } = installMocks((step) => order.push(step));
    process.env.NEXT_RUNTIME = "nodejs";
    delete process.env.NEXT_PHASE;
    vi.useFakeTimers();

    await runRegister();

    expect(startWebhookDispatcher).not.toHaveBeenCalled();
    expect(getSettings).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(4000);

    expect(getSettings).toHaveBeenCalledTimes(1);
    expect(startWebhookDispatcher).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["cleanup", "settings", "scheduler"]);
  });

  it.each(["phase-production-build", "phase-export", "phase-static"])(
    "register keeps %s free of app side effects",
    async (phase) => {
      const { startWebhookDispatcher, getSettings } = installMocks();
      process.env.NEXT_RUNTIME = "nodejs";
      process.env.NEXT_PHASE = phase;
      vi.useFakeTimers();

      await runRegister();
      await vi.advanceTimersByTimeAsync(4000);

      expect(getSettings).not.toHaveBeenCalled();
      expect(startWebhookDispatcher).not.toHaveBeenCalled();
    },
  );

  it("register stays single-instance across reloads and repeated server boots", async () => {
    const first = installMocks();
    process.env.NEXT_RUNTIME = "nodejs";
    delete process.env.NEXT_PHASE;
    vi.useFakeTimers();

    await runRegister();
    await runRegister();
    await vi.advanceTimersByTimeAsync(4000);
    expect(first.startWebhookDispatcher).toHaveBeenCalledTimes(1);

    vi.resetModules();
    const second = installMocks();
    await runRegister();
    await vi.advanceTimersByTimeAsync(4000);

    expect(second.startWebhookDispatcher).not.toHaveBeenCalled();
    expect(first.startWebhookDispatcher).toHaveBeenCalledTimes(1);
  });
});
