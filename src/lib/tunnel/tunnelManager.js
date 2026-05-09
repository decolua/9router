import crypto from "crypto";
import { loadState, saveState, generateShortId } from "./state.js";
import { spawnQuickTunnel, killCloudflared, isCloudflaredRunning, setUnexpectedExitHandler } from "./cloudflared.js";
import { startFunnel, stopFunnel, isTailscaleRunning, isTailscaleRunningStrict, isTailscaleLoggedIn, startLogin, startDaemonWithPassword } from "./tailscale.js";
import { getSettings, updateSettings } from "@/lib/localDb";
import { getCachedPassword, loadEncryptedPassword, initDbHooks } from "@/mitm/manager";
import { waitForHealth, probeUrlAlive } from "./networkProbe.js";

initDbHooks(getSettings, updateSettings);

const WORKER_URL = process.env.TUNNEL_WORKER_URL || "https://9router.com";
const MACHINE_ID_SALT = "9router-tunnel-salt";

// Per-service state (independent: tunnel ≠ tailscale)
const tunnelSvc = {
  cancelToken: { cancelled: false },
  spawnInProgress: false,
  lastRestartAt: 0,
  activeLocalPort: null,
};

const tailscaleSvc = {
  cancelToken: { cancelled: false },
  spawnInProgress: false,
  lastRestartAt: 0,
  activeLocalPort: null,
};

export function getTunnelService() { return tunnelSvc; }
export function getTailscaleService() { return tailscaleSvc; }

export function isTunnelManuallyDisabled() { return tunnelSvc.cancelToken.cancelled; }
export function isTunnelReconnecting() { return tunnelSvc.spawnInProgress; }
export function isTailscaleReconnecting() { return tailscaleSvc.spawnInProgress; }

// ─── Reachable cache: background probe of tunnel URL /api/health ─────────────
// UI uses this to know if the public URL actually serves content (not just process alive)
const REACHABLE_TTL_MS = 30000;
const tunnelReachable = { value: false, url: null, fetchedAt: 0, refreshing: false };
const tailscaleReachable = { value: false, url: null, fetchedAt: 0, refreshing: false };

function bgRefreshReachable(cache, url) {
  if (cache.refreshing) return;
  if (!url) { cache.value = false; cache.url = null; cache.fetchedAt = Date.now(); return; }
  cache.refreshing = true;
  probeUrlAlive(url)
    .then((ok) => { cache.value = ok; })
    .catch(() => { cache.value = false; })
    .finally(() => {
      cache.url = url;
      cache.fetchedAt = Date.now();
      cache.refreshing = false;
    });
}

function readReachable(cache, url) {
  // URL changed → invalidate
  if (cache.url !== url) { cache.value = false; cache.fetchedAt = 0; }
  if (Date.now() - cache.fetchedAt > REACHABLE_TTL_MS) bgRefreshReachable(cache, url);
  return cache.value;
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

function throwIfCancelled(token, label) {
  if (token.cancelled) throw new Error(`${label} cancelled`);
}

export async function enableTunnel(localPort = 20128) {
  tunnelSvc.cancelToken = { cancelled: false };
  tunnelSvc.activeLocalPort = localPort;
  tunnelSvc.spawnInProgress = true;
  const token = tunnelSvc.cancelToken;

  try {
    if (isCloudflaredRunning()) {
      const existing = loadState();
      if (existing?.tunnelUrl && await probeUrlAlive(existing.tunnelUrl)) {
        const publicUrl = `https://r${existing.shortId}.9router.com`;
        return { success: true, tunnelUrl: existing.tunnelUrl, shortId: existing.shortId, publicUrl, alreadyRunning: true };
      }
    }

    killCloudflared(localPort);
    throwIfCancelled(token, "tunnel");

    const machineId = getMachineId();
    const existing = loadState();
    const shortId = existing?.shortId || generateShortId();

    const onUrlUpdate = async (url) => {
      if (token.cancelled) return;
      await registerTunnelUrl(shortId, url);
      saveState({ shortId, machineId, tunnelUrl: url });
      await updateSettings({ tunnelEnabled: true, tunnelUrl: url });
    };

    const { tunnelUrl } = await spawnQuickTunnel(localPort, onUrlUpdate);
    throwIfCancelled(token, "tunnel");

    const publicUrl = `https://r${shortId}.9router.com`;
    await registerTunnelUrl(shortId, tunnelUrl);
    saveState({ shortId, machineId, tunnelUrl });
    await updateSettings({ tunnelEnabled: true, tunnelUrl });

    // Verify direct tunnel URL is reachable first (avoid CDN-cache false positive on publicUrl)
    await waitForHealth(tunnelUrl, token);
    // Then verify public URL (DNS propagated through 9router.com worker)
    await waitForHealth(publicUrl, token);

    // Prime reachable cache so UI shows correct state immediately
    tunnelReachable.value = true;
    tunnelReachable.url = tunnelUrl;
    tunnelReachable.fetchedAt = Date.now();

    return { success: true, tunnelUrl, shortId, publicUrl };
  } finally {
    tunnelSvc.spawnInProgress = false;
  }
}

export async function disableTunnel() {
  tunnelSvc.cancelToken.cancelled = true;
  setUnexpectedExitHandler(null);
  killCloudflared(tunnelSvc.activeLocalPort);

  const state = loadState();
  if (state) saveState({ shortId: state.shortId, machineId: state.machineId, tunnelUrl: null });

  await updateSettings({ tunnelEnabled: false, tunnelUrl: "" });
  tunnelReachable.value = false; tunnelReachable.url = null; tunnelReachable.fetchedAt = Date.now();
  return { success: true };
}

export async function getTunnelStatus() {
  const settings = await getSettings();
  const settingsEnabled = settings.tunnelEnabled === true;
  const state = loadState();
  const shortId = state?.shortId || "";
  const publicUrl = shortId ? `https://r${shortId}.9router.com` : "";
  const tunnelUrl = state?.tunnelUrl || "";

  // Lazy: skip PID probe entirely when user disabled tunnel
  const running = settingsEnabled ? isCloudflaredRunning() : false;
  // Reachable: cached background probe (never blocks the request)
  const reachable = settingsEnabled && running ? readReachable(tunnelReachable, tunnelUrl) : false;

  return {
    enabled: settingsEnabled && running,
    settingsEnabled,
    tunnelUrl,
    shortId,
    publicUrl,
    running,
    reachable
  };
}

// ─── Tailscale Funnel ─────────────────────────────────────────────────────────

export async function enableTailscale(localPort = 20128) {
  tailscaleSvc.cancelToken = { cancelled: false };
  tailscaleSvc.activeLocalPort = localPort;
  tailscaleSvc.spawnInProgress = true;
  const token = tailscaleSvc.cancelToken;

  try {
    const sudoPass = getCachedPassword() || await loadEncryptedPassword() || "";
    await startDaemonWithPassword(sudoPass);
    throwIfCancelled(token, "tailscale");

    const existing = loadState();
    const shortId = existing?.shortId || generateShortId();
    const tsHostname = shortId;

    if (!isTailscaleLoggedIn()) {
      const loginResult = await startLogin(tsHostname);
      if (loginResult.authUrl) return { success: false, needsLogin: true, authUrl: loginResult.authUrl };
    }
    throwIfCancelled(token, "tailscale");

    stopFunnel();
    const result = await startFunnel(localPort);
    throwIfCancelled(token, "tailscale");

    if (result.funnelNotEnabled) {
      return { success: false, funnelNotEnabled: true, enableUrl: result.enableUrl };
    }

    // Strict probe: bypass cache so we don't false-negative on first invocation
    if (!isTailscaleLoggedIn() || !isTailscaleRunningStrict()) {
      stopFunnel();
      return { success: false, error: "Tailscale not connected. Device may have been removed. Please re-login." };
    }

    await updateSettings({ tailscaleEnabled: true, tailscaleUrl: result.tunnelUrl });

    // Verify funnel actually serves /api/health
    await waitForHealth(result.tunnelUrl, token);

    // Prime reachable cache so UI shows correct state immediately
    tailscaleReachable.value = true;
    tailscaleReachable.url = result.tunnelUrl;
    tailscaleReachable.fetchedAt = Date.now();

    return { success: true, tunnelUrl: result.tunnelUrl };
  } finally {
    tailscaleSvc.spawnInProgress = false;
  }
}

export async function disableTailscale() {
  tailscaleSvc.cancelToken.cancelled = true;
  stopFunnel();
  await updateSettings({ tailscaleEnabled: false, tailscaleUrl: "" });
  tailscaleReachable.value = false; tailscaleReachable.url = null; tailscaleReachable.fetchedAt = Date.now();
  return { success: true };
}

export async function getTailscaleStatus() {
  const settings = await getSettings();
  const settingsEnabled = settings.tailscaleEnabled === true;
  const tunnelUrl = settings.tailscaleUrl || "";
  // Lazy: skip execSync funnel-status probe when user disabled Tailscale
  const running = settingsEnabled ? isTailscaleRunning() : false;
  // Reachable: cached background probe (never blocks the request)
  const reachable = settingsEnabled && running ? readReachable(tailscaleReachable, tunnelUrl) : false;
  return {
    enabled: settingsEnabled && running,
    settingsEnabled,
    tunnelUrl,
    running,
    reachable
  };
}
