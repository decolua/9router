import crypto from "crypto";
import { loadState, saveState, generateShortId } from "./state.js";
import { spawnQuickTunnel, killCloudflared, isCloudflaredRunning, setUnexpectedExitHandler } from "./cloudflared.js";
import { startFunnel, stopFunnel, stopDaemon, isTailscaleRunning, isTailscaleLoggedIn, startLogin, startDaemonWithPassword } from "./tailscale.js";
import { getSettings, updateSettings } from "@/lib/localDb";
import { getCachedPassword, loadEncryptedPassword, initDbHooks } from "@/mitm/manager";

initDbHooks(getSettings, updateSettings);

const WORKER_URL = process.env.TUNNEL_WORKER_URL || "https://9router.com";
const MACHINE_ID_SALT = "9router-tunnel-salt";
const RECONNECT_DELAYS_MS = [5000, 10000, 20000, 30000, 60000];
const MAX_RECONNECT_ATTEMPTS = RECONNECT_DELAYS_MS.length;

let isReconnecting = false;
let exitHandlerRegistered = false;
let reconnectTimeoutId = null;
let manualDisabled = false;

export function isTunnelManuallyDisabled() {
  return manualDisabled;
}

export function isTunnelReconnecting() {
  return isReconnecting;
}

function getMachineId() {
  try {
    const { machineIdSync } = require("node-machine-id");
    const raw = machineIdSync();
    return crypto.createHash("sha256").update(raw + MACHINE_ID_SALT).digest("hex").substring(0, 16);
  } catch (e) {
    return crypto.randomUUID().replace(/-/g, "").substring(0, 16);
  }
}

// ─── Cloudflare Tunnel ───────────────────────────────────────────────────────

async function registerTunnelUrl(shortId, tunnelUrl) {
  await fetch(`${WORKER_URL}/api/tunnel/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shortId, tunnelUrl })
  });
}

export async function enableTunnel(localPort = 20128) {
  manualDisabled = false;

  if (isCloudflaredRunning()) {
    const existing = loadState();
    if (existing?.tunnelUrl) {
      const publicUrl = `https://r${existing.shortId}.9router.com`;
      return { success: true, tunnelUrl: existing.tunnelUrl, shortId: existing.shortId, publicUrl, alreadyRunning: true };
    }
  }

  killCloudflared();

  const machineId = getMachineId();
  const existing = loadState();
  const shortId = existing?.shortId || generateShortId();

  // onUrlUpdate: called when URL changes AFTER initial connect
  const onUrlUpdate = async (url) => {
    if (manualDisabled) return;
    await registerTunnelUrl(shortId, url);
    saveState({ shortId, machineId, tunnelUrl: url });
    await updateSettings({ tunnelEnabled: true, tunnelUrl: url });
  };

  const { tunnelUrl } = await spawnQuickTunnel(localPort, onUrlUpdate);

  await registerTunnelUrl(shortId, tunnelUrl);
  saveState({ shortId, machineId, tunnelUrl });
  await updateSettings({ tunnelEnabled: true, tunnelUrl });

  if (!exitHandlerRegistered) {
    setUnexpectedExitHandler(() => {
      if (!isReconnecting) scheduleReconnect(0);
    });
    exitHandlerRegistered = true;
  }

  const publicUrl = `https://r${shortId}.9router.com`;
  return { success: true, tunnelUrl, shortId, publicUrl };
}

async function scheduleReconnect(attempt) {
  if (isReconnecting || manualDisabled) return;
  isReconnecting = true;

  const delay = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)];
  console.log(`[Tunnel] Reconnecting in ${delay / 1000}s (attempt ${attempt + 1})...`);

  await new Promise((r) => { reconnectTimeoutId = setTimeout(r, delay); });

  try {
    if (manualDisabled) { isReconnecting = false; return; }
    const settings = await getSettings();
    if (!settings.tunnelEnabled) { isReconnecting = false; return; }
    await enableTunnel();
    console.log("[Tunnel] Reconnected successfully");
    isReconnecting = false;
  } catch (err) {
    console.log(`[Tunnel] Reconnect attempt ${attempt + 1} failed:`, err.message);
    isReconnecting = false;
    const next = attempt + 1;
    if (next < MAX_RECONNECT_ATTEMPTS) scheduleReconnect(next);
    else {
      console.log("[Tunnel] All reconnect attempts exhausted, disabling tunnel");
      await updateSettings({ tunnelEnabled: false });
    }
  }
}

export async function disableTunnel() {
  manualDisabled = true;
  isReconnecting = true;
  if (reconnectTimeoutId) {
    clearTimeout(reconnectTimeoutId);
    reconnectTimeoutId = null;
  }
  setUnexpectedExitHandler(null);
  exitHandlerRegistered = false;

  killCloudflared();

  const state = loadState();
  if (state) {
    saveState({ shortId: state.shortId, machineId: state.machineId, tunnelUrl: null });
  }

  await updateSettings({ tunnelEnabled: false, tunnelUrl: "" });
  isReconnecting = false;
  return { success: true };
}

export async function getTunnelStatus() {
  const state = loadState();
  const running = isCloudflaredRunning();
  const settings = await getSettings();
  const shortId = state?.shortId || "";
  const publicUrl = shortId ? `https://r${shortId}.9router.com` : "";

  return {
    enabled: settings.tunnelEnabled === true && running,
    tunnelUrl: state?.tunnelUrl || "",
    shortId,
    publicUrl,
    running
  };
}

// ─── Tailscale Funnel ─────────────────────────────────────────────────────────

export async function enableTailscale(localPort = 20128) {
  // Ensure daemon is running (needs sudo for TUN mode)
  const sudoPass = getCachedPassword() || await loadEncryptedPassword() || "";
  await startDaemonWithPassword(sudoPass);

  // Generate hostname from machine ID (same as tunnel shortId prefix)
  const existing = loadState();
  const shortId = existing?.shortId || generateShortId();
  const tsHostname = shortId;

  // If not logged in, return auth URL for user to authenticate
  if (!isTailscaleLoggedIn()) {
    const loginResult = await startLogin(tsHostname);
    if (loginResult.authUrl) {
      return { success: false, needsLogin: true, authUrl: loginResult.authUrl };
    }
  }

  stopFunnel();
  const result = await startFunnel(localPort);

  // Funnel not enabled on tailnet — return enable URL
  if (result.funnelNotEnabled) {
    return { success: false, funnelNotEnabled: true, enableUrl: result.enableUrl };
  }

  // Verify device is actually connected (BackendState=Running + funnel active)
  if (!isTailscaleLoggedIn() || !isTailscaleRunning()) {
    stopFunnel();
    return { success: false, error: "Tailscale not connected. Device may have been removed. Please re-login." };
  }

  await updateSettings({ tailscaleEnabled: true, tailscaleUrl: result.tunnelUrl });
  return { success: true, tunnelUrl: result.tunnelUrl };
}

export async function disableTailscale() {
  stopFunnel();
  const sudoPass = getCachedPassword() || await loadEncryptedPassword() || "";
  await stopDaemon(sudoPass);
  await updateSettings({ tailscaleEnabled: false, tailscaleUrl: "" });
  return { success: true };
}

export async function getTailscaleStatus() {
  const settings = await getSettings();
  const running = isTailscaleRunning();
  return {
    enabled: settings.tailscaleEnabled === true && running,
    tunnelUrl: settings.tailscaleUrl || "",
    running
  };
}
