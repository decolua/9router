import { cleanupProviderConnections, getSettings, updateSettings, getApiKeys } from "@/lib/localDb";
import { enableTunnel } from "@/lib/tunnel/tunnelManager";
import { killCloudflared, isCloudflaredRunning, ensureCloudflared } from "@/lib/tunnel/cloudflared";
import { getMitmStatus, startMitm, loadEncryptedPassword, initDbHooks } from "@/mitm/manager";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync } from "fs";

import os from "os";

// Inject correct paths and DB hooks into manager.js (CJS) from ESM context.
// Must run before any MITM function is called.
(function bootstrapMitm() {
  // 1. Resolve server.js path from real ESM __filename (not bundled path)
  if (!process.env.MITM_SERVER_PATH) {
    try {
      const thisFile = fileURLToPath(import.meta.url);
      const appSrc = dirname(dirname(thisFile)); // src/
      const candidate = join(appSrc, "mitm", "server.js");
      if (existsSync(candidate)) {
        process.env.MITM_SERVER_PATH = candidate;
      }
    } catch { /* ignore */ }
  }

  // 2. Inject DB functions so manager.js (CJS) can save/load settings
  //    without dynamic import issues inside webpack bundles
  try {
    initDbHooks(getSettings, updateSettings);
  } catch { /* ignore */ }
})();

// Multiple modules register SIGINT/SIGTERM handlers legitimately
process.setMaxListeners(20);

let signalHandlersRegistered = false;
let watchdogInterval = null;
let networkMonitorInterval = null;
let lastNetworkFingerprint = null;
let lastWatchdogTick = Date.now();
let lastTunnelRestartAt = 0;
let tunnelRestartInProgress = false;
const WATCHDOG_INTERVAL_MS = 60000;
const NETWORK_CHECK_INTERVAL_MS = 5000;
const NETWORK_RESTART_COOLDOWN_MS = 30000;

/**
 * Initialize app on startup
 * - Cleanup stale data
 * - Auto-reconnect tunnel if previously enabled
 * - Register shutdown handler to kill cloudflared
 * - Start watchdog to recover tunnel after sleep/wake
 */
export async function initializeApp() {
  try {
    await cleanupProviderConnections();

    // Auto-reconnect tunnel if it was enabled before restart
    const settings = await getSettings();
    if (settings.tunnelEnabled && !isCloudflaredRunning()) {
      console.log("[InitApp] Tunnel was enabled, auto-reconnecting...");
      try {
        await enableTunnel();
        console.log("[InitApp] Tunnel reconnected");
      } catch (error) {
        console.log("[InitApp] Tunnel reconnect failed:", error.message);
      }
    }

    // Kill cloudflared on process exit (register once only)
    if (!signalHandlersRegistered) {
      const cleanup = () => {
        killCloudflared();
        process.exit();
      };
      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);
      signalHandlersRegistered = true;
    }

    // Pre-download cloudflared binary in background
    ensureCloudflared().catch(() => {});

    // Watchdog: recover tunnel after process crash
    startWatchdog();

    // Network monitor: detect sleep/wake + network changes → restart tunnel
    startNetworkMonitor();

    // Auto-start MITM if it was enabled before restart
    autoStartMitm();
  } catch (error) {
    console.error("[InitApp] Error:", error);
  }
}

/** Auto-start MITM if it was enabled before restart */
async function autoStartMitm() {
  try {
    const settings = await getSettings();
    if (!settings.mitmEnabled) return;

    const mitmStatus = await getMitmStatus();
    if (mitmStatus.running) return;

    const password = await loadEncryptedPassword();
    if (!password && process.platform !== "win32") {
      console.log("[InitApp] MITM was enabled but no saved password found, skipping auto-start");
      return;
    }

    // Need an active API key
    const keys = await getApiKeys();
    const activeKey = keys.find(k => k.isActive !== false);
    if (!activeKey) {
      console.log("[InitApp] MITM auto-start skipped: no active API key");
      return;
    }

    console.log("[InitApp] MITM was enabled, auto-starting...");
    await startMitm(activeKey.key, password || "");
    console.log("[InitApp] MITM auto-started");
  } catch (err) {
    console.log("[InitApp] MITM auto-start failed:", err.message);
  }
}

/** Periodically check tunnel process health and reconnect if crashed */
function startWatchdog() {
  if (watchdogInterval) return;
  watchdogInterval = setInterval(async () => {
    try {
      const settings = await getSettings();
      if (!settings.tunnelEnabled) return;
      if (isCloudflaredRunning()) return;
      console.log("[Watchdog] Tunnel process is down, attempting recovery...");
      await enableTunnel();
      console.log("[Watchdog] Tunnel recovered");
    } catch (err) {
      console.log("[Watchdog] Recovery failed:", err.message);
    }
  }, WATCHDOG_INTERVAL_MS);

  if (watchdogInterval.unref) watchdogInterval.unref();
}

/** Get network fingerprint from active interfaces (IPv4 only) */
function getNetworkFingerprint() {
  const interfaces = os.networkInterfaces();
  const active = [];
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (!addr.internal && addr.family === "IPv4") {
        active.push(`${name}:${addr.address}`);
      }
    }
  }
  return active.sort().join("|");
}

/** Monitor network changes + sleep/wake → kill and reconnect tunnel */
function startNetworkMonitor() {
  if (networkMonitorInterval) return;

  lastNetworkFingerprint = getNetworkFingerprint();
  lastWatchdogTick = Date.now();

  networkMonitorInterval = setInterval(async () => {
    try {
      const settings = await getSettings();
      if (!settings.tunnelEnabled) return;

      const now = Date.now();
      const elapsed = now - lastWatchdogTick;
      lastWatchdogTick = now;

      const currentFingerprint = getNetworkFingerprint();
      const networkChanged = currentFingerprint !== lastNetworkFingerprint;
      const wasSleep = elapsed > NETWORK_CHECK_INTERVAL_MS * 3;

      if (networkChanged) lastNetworkFingerprint = currentFingerprint;

      if (!networkChanged && !wasSleep) return;

      // Skip if restart already in progress or restarted recently
      if (tunnelRestartInProgress) return;
      if (now - lastTunnelRestartAt < NETWORK_RESTART_COOLDOWN_MS) return;

      const reason = wasSleep && networkChanged ? "sleep/wake + network change"
        : wasSleep ? "sleep/wake" : "network change";
      console.log(`[NetworkMonitor] ${reason} detected, restarting tunnel...`);

      tunnelRestartInProgress = true;
      lastTunnelRestartAt = now;
      try {
        killCloudflared();
        await new Promise(r => setTimeout(r, 2000));
        await enableTunnel();
        console.log("[NetworkMonitor] Tunnel restarted");
        lastNetworkFingerprint = getNetworkFingerprint();
      } finally {
        tunnelRestartInProgress = false;
      }
    } catch (err) {
      console.log("[NetworkMonitor] Tunnel restart failed:", err.message);
    }
  }, NETWORK_CHECK_INTERVAL_MS);

  if (networkMonitorInterval.unref) networkMonitorInterval.unref();
}

export default initializeApp;
