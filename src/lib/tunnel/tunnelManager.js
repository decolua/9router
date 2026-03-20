import crypto from "crypto";
import { loadState, saveState } from "./state.js";
import { spawnQuickTunnel, killCloudflared, isCloudflaredRunning, setUnexpectedExitHandler } from "./cloudflared.js";
import { getSettings, updateSettings } from "@/lib/localDb";

const WORKER_URL = process.env.TUNNEL_WORKER_URL || "https://9router.com";
const MACHINE_ID_SALT = "9router-tunnel-salt";
const SHORT_ID_LENGTH = 6;
const SHORT_ID_CHARS = "abcdefghijklmnpqrstuvwxyz23456789";
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

function generateShortId() {
  let result = "";
  for (let i = 0; i < SHORT_ID_LENGTH; i++) {
    result += SHORT_ID_CHARS.charAt(Math.floor(Math.random() * SHORT_ID_CHARS.length));
  }
  return result;
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

/**
 * Register quick tunnel URL to worker (called on start and URL change)
 */
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
      return { success: true, tunnelUrl: existing.tunnelUrl, shortId: existing.shortId, alreadyRunning: true };
    }
  }

  killCloudflared();

  const machineId = getMachineId();
  const existing = loadState();
  const shortId = existing?.shortId || generateShortId();

  // onUrlUpdate: only called when URL changes AFTER initial connect (not on first resolve)
  const onUrlUpdate = async (url) => {
    if (manualDisabled) return;
    await registerTunnelUrl(shortId, url);
    saveState({ shortId, machineId, tunnelUrl: url });
    await updateSettings({ tunnelEnabled: true, tunnelUrl: url });
  };

  // Spawn quick tunnel — resolve returns initial URL, onUrlUpdate handles subsequent changes
  const { tunnelUrl } = await spawnQuickTunnel(localPort, onUrlUpdate);

  // Register initial URL (exactly once)
  await registerTunnelUrl(shortId, tunnelUrl);
  saveState({ shortId, machineId, tunnelUrl });
  await updateSettings({ tunnelEnabled: true, tunnelUrl });

  // Set exit handler only once (not on every reconnect)
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
    if (manualDisabled) {
      isReconnecting = false;
      return;
    }
    const settings = await getSettings();
    if (!settings.tunnelEnabled) {
      isReconnecting = false;
      return;
    }
    await enableTunnel();
    console.log("[Tunnel] Reconnected successfully");
    isReconnecting = false;
  } catch (err) {
    console.log(`[Tunnel] Reconnect attempt ${attempt + 1} failed:`, err.message);
    isReconnecting = false;
    const nextAttempt = attempt + 1;
    if (nextAttempt < MAX_RECONNECT_ATTEMPTS) scheduleReconnect(nextAttempt);
    else console.log("[Tunnel] All reconnect attempts exhausted");
  }
}

export async function disableTunnel() {
  // Block any reconnect attempts before killing the process
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

  // Unblock reconnect lock — manualDisabled stays true to block Watchdog/NetworkMonitor
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
