import { getSettings, updateSettings } from "@/lib/localDb.js";
import { runWebshareSync } from "./webshareSync.js";

const g = global.__appSingleton ??= {
  signalHandlersRegistered: false,
  watchdogInterval: null,
  networkMonitorInterval: null,
  webshareSyncInterval: null,
  lastNetworkFingerprint: null,
  lastWatchdogTick: Date.now(),
  lastOnline: null,
  mitmStartInProgress: false,
  tunnelAutoResumed: false,
  tailscaleAutoResumed: false,
};

function getIntervalMs(settings) {
  return (Number(settings.webshareSyncIntervalMinutes) || 60) * 60 * 1000;
}

function setWebshareInterval(intervalMs) {
  g.webshareSyncInterval = setInterval(async () => {
    await tickWebshareScheduler();
  }, intervalMs);
  g.webshareSyncInterval._webshareIntervalMs = intervalMs;
  if (g.webshareSyncInterval.unref) g.webshareSyncInterval.unref();
}

async function tickWebshareScheduler() {
  try {
    const settings = await getSettings();
    const webshareApiKey = settings.webshareApiKey?.trim();
    const intervalMs = getIntervalMs(settings);

    if (g.webshareSyncInterval?._webshareIntervalMs !== intervalMs) {
      clearInterval(g.webshareSyncInterval);
      g.webshareSyncInterval = null;
      setWebshareInterval(intervalMs);
    }

    if (!settings.webshareAutoSyncEnabled || !webshareApiKey) {
      return;
    }

    // Call service directly — HTTP self-fetch would 401 under requireLogin auth guard.
    await runWebshareSync({ trigger: "scheduler" });
  } catch (err) {
    await updateSettings({
      webshareLastSyncError: err instanceof Error ? err.message : String(err),
    }).catch(() => {});
  }
}

export function startWebshareScheduler() {
  if (g.webshareSyncInterval) return;

  setWebshareInterval(60 * 60 * 1000);

  setTimeout(() => {
    tickWebshareScheduler().catch(() => {});
  }, 30000);
}
