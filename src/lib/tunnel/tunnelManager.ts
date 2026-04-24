import crypto from "crypto";
import { getMachineId as getSysMachineId } from "@/shared/utils/machine";
import { loadState, saveState, generateShortId, type TunnelState } from "./state";
import { spawnQuickTunnel, killCloudflared, isCloudflaredRunning, setUnexpectedExitHandler } from "./cloudflared";
import { startFunnel, stopFunnel, stopDaemon, isTailscaleRunning, isTailscaleLoggedIn, startLogin, startDaemonWithPassword } from "./tailscale";
import { getSettings, updateSettings, type Settings } from "@/lib/localDb";
import { getCachedPassword, loadEncryptedPassword, initDbHooks } from "@/mitm/manager";

initDbHooks(getSettings, updateSettings);

const WORKER_URL = process.env.TUNNEL_WORKER_URL || "https://8router.com";
const RECONNECT_DELAYS_MS = [5000, 10000, 20000, 30000, 60000];
const MAX_RECONNECT_ATTEMPTS = RECONNECT_DELAYS_MS.length;

let isReconnecting = false;
let exitHandlerRegistered = false;
let reconnectTimeoutId: NodeJS.Timeout | null = null;
let manualDisabled = false;

export function isTunnelManuallyDisabled(): boolean {
  return manualDisabled;
}

export function isTunnelReconnecting(): boolean {
  return isReconnecting;
}

// ─── Cloudflare Tunnel ───────────────────────────────────────────────────────

async function registerTunnelUrl(shortId: string, tunnelUrl: string): Promise<void> {
  await fetch(`${WORKER_URL}/api/tunnel/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shortId, tunnelUrl })
  });
}

export async function enableTunnel(localPort: number = 20128): Promise<{ success: boolean; tunnelUrl?: string; shortId?: string; publicUrl?: string; alreadyRunning?: boolean }> {
  manualDisabled = false;

  if (isCloudflaredRunning()) {
    const existing = loadState();
    if (existing?.tunnelUrl) {
      const publicUrl = `https://r${existing.shortId}.8router.com`;
      return { success: true, tunnelUrl: existing.tunnelUrl, shortId: existing.shortId, publicUrl, alreadyRunning: true };
    }
  }

  killCloudflared();

  const machineId = await getSysMachineId();
  const existing = loadState();
  const shortId = existing?.shortId || generateShortId();

  const onUrlUpdate = async (url: string) => {
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

  const publicUrl = `https://r${shortId}.8router.com`;
  return { success: true, tunnelUrl, shortId, publicUrl };
}

async function scheduleReconnect(attempt: number): Promise<void> {
  if (isReconnecting || manualDisabled) return;
  isReconnecting = true;

  const delay = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)];
  console.log(`[Tunnel] Reconnecting in ${delay / 1000}s (attempt ${attempt + 1})...`);

  await new Promise<void>((r) => { reconnectTimeoutId = setTimeout(r, delay); });

  try {
    if (manualDisabled) { isReconnecting = false; return; }
    const settings = await getSettings();
    if (!settings.tunnelEnabled) { isReconnecting = false; return; }
    await enableTunnel();
    console.log("[Tunnel] Reconnected successfully");
    isReconnecting = false;
  } catch (err: any) {
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

export async function disableTunnel(): Promise<{ success: boolean }> {
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
  const publicUrl = shortId ? `https://r${shortId}.8router.com` : "";

  return {
    enabled: settings.tunnelEnabled === true && running,
    tunnelUrl: state?.tunnelUrl || "",
    shortId,
    publicUrl,
    running
  };
}

// ─── Tailscale Funnel ─────────────────────────────────────────────────────────

export async function enableTailscale(localPort: number = 20128): Promise<{ success: boolean; tunnelUrl?: string; needsLogin?: boolean; authUrl?: string; funnelNotEnabled?: boolean; enableUrl?: string; error?: string }> {
  const sudoPass = getCachedPassword() || await loadEncryptedPassword() || "";
  await startDaemonWithPassword(sudoPass);

  const existing = loadState();
  const shortId = existing?.shortId || generateShortId();
  const tsHostname = shortId;

  if (!isTailscaleLoggedIn()) {
    const loginResult = await startLogin(tsHostname);
    if (loginResult.authUrl) {
      return { success: false, needsLogin: true, authUrl: loginResult.authUrl };
    }
  }

  stopFunnel();
  const result = await startFunnel(localPort);

  if (result.funnelNotEnabled) {
    return { success: false, funnelNotEnabled: true, enableUrl: result.enableUrl };
  }

  if (!isTailscaleLoggedIn() || !isTailscaleRunning()) {
    stopFunnel();
    return { success: false, error: "Tailscale not connected. Device may have been removed. Please re-login." };
  }

  await updateSettings({ tailscaleEnabled: true, tailscaleUrl: result.tunnelUrl });
  return { success: true, tunnelUrl: result.tunnelUrl };
}

export async function disableTailscale(): Promise<{ success: boolean }> {
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
