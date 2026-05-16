import crypto from "crypto";
import { loadState, saveState, generateShortId } from "./state.js";
import { spawnQuickTunnel, killCloudflared, isCloudflaredRunning, setUnexpectedExitHandler } from "./cloudflared.js";
import { startFunnel, stopFunnel, isTailscaleRunning, isTailscaleRunningStrict, isTailscaleLoggedIn, startLogin, startDaemonWithPassword, provisionCert } from "./tailscale.js";
import { getSettings, updateSettings } from "@/lib/localDb";
import { getCachedPassword, loadEncryptedPassword, initDbHooks } from "@/mitm/manager";
import { waitForHealth, probeUrlAlive } from "./networkProbe.js";

initDbHooks(getSettings, updateSettings);

const WORKER_URL = process.env.TUNNEL_WORKER_URL || "https://abc-tunnel.us";
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
  console.log(`[Tunnel] enable start (port=${localPort})`);
  tunnelSvc.cancelToken = { cancelled: false };
  tunnelSvc.activeLocalPort = localPort;
  tunnelSvc.spawnInProgress = true;
  const token = tunnelSvc.cancelToken;

  try {
    if (isCloudflaredRunning()) {
      const existing = loadState();
      if (existing?.tunnelUrl && await probeUrlAlive(existing.tunnelUrl)) {
        const publicUrl = `https://r${existing.shortId}.abc-tunnel.us`;
        console.log(`[Tunnel] already running, reuse: ${existing.tunnelUrl}`);
        return { success: true, tunnelUrl: existing.tunnelUrl, shortId: existing.shortId, publicUrl, alreadyRunning: true };
      }
    }

    killCloudflared(localPort);
    console.log("[Tunnel] killed existing cloudflared");
    throwIfCancelled(token, "tunnel");

    const machineId = getMachineId();
    const existing = loadState();
    const shortId = existing?.shortId || generateShortId();

    const onUrlUpdate = async (url) => {
      if (token.cancelled) return;
      console.log(`[Tunnel] url updated: ${url}`);
      await registerTunnelUrl(shortId, url);
      saveState({ shortId, machineId, tunnelUrl: url });
      await updateSettings({ tunnelEnabled: true, tunnelUrl: url });
    };

    const { tunnelUrl } = await spawnQuickTunnel(localPort, onUrlUpdate);
    console.log(`[Tunnel] spawned: ${tunnelUrl}`);
    throwIfCancelled(token, "tunnel");

    const publicUrl = `https://r${shortId}.abc-tunnel.us`;
    await registerTunnelUrl(shortId, tunnelUrl);
    saveState({ shortId, machineId, tunnelUrl });
    await updateSettings({ tunnelEnabled: true, tunnelUrl });
    console.log(`[Tunnel] registered shortId=${shortId} publicUrl=${publicUrl}`);

    // Verify direct tunnel URL first (avoid CDN false positive on publicUrl)
    await waitForHealth(tunnelUrl, token);
    console.log("[Tunnel] direct URL healthy");
    // Then verify public URL (DNS propagated through worker)
    await waitForHealth(publicUrl, token);
    console.log("[Tunnel] public URL healthy");

    // Prime reachable cache so UI shows correct state immediately
    tunnelReachable.value = true;
    tunnelReachable.url = tunnelUrl;
    tunnelReachable.fetchedAt = Date.now();

    console.log("[Tunnel] enable success");
    return { success: true, tunnelUrl, shortId, publicUrl };
  } catch (e) {
    console.error(`[Tunnel] enable error: ${e.message}`);
    throw e;
  } finally {
    tunnelSvc.spawnInProgress = false;
  }
}

export async function disableTunnel() {
  console.log("[Tunnel] disable");
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
  const publicUrl = shortId ? `https://r${shortId}.abc-tunnel.us` : "";
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
  console.log(`[Tailscale] enable start (port=${localPort})`);
  tailscaleSvc.cancelToken = { cancelled: false };
  tailscaleSvc.activeLocalPort = localPort;
  tailscaleSvc.spawnInProgress = true;
  const token = tailscaleSvc.cancelToken;

  try {
    const sudoPass = getCachedPassword() || await loadEncryptedPassword() || "";
    await startDaemonWithPassword(sudoPass);
    console.log("[Tailscale] daemon ready");
    throwIfCancelled(token, "tailscale");

    const existing = loadState();
    const shortId = existing?.shortId || generateShortId();
    const tsHostname = shortId;

    const loggedIn = isTailscaleLoggedIn();
    console.log(`[Tailscale] loggedIn=${loggedIn}`);
    if (!loggedIn) {
      const loginResult = await startLogin(tsHostname);
      if (loginResult.authUrl) {
        console.log(`[Tailscale] needs login, authUrl=${loginResult.authUrl}`);
        return { success: false, needsLogin: true, authUrl: loginResult.authUrl };
      }
      console.log("[Tailscale] login resolved alreadyLoggedIn");
    }
    throwIfCancelled(token, "tailscale");

    stopFunnel();
    let result;
    try {
      console.log("[Tailscale] starting funnel");
      result = await startFunnel(localPort);
    } catch (e) {
      console.error(`[Tailscale] funnel error: ${e.message}`);
      // Daemon not logged in / not ready → auto-trigger login flow so user stays in-app
      if (/NoState|unexpected state|not logged in|Logged ?out|NeedsLogin/i.test(e.message || "")) {
        console.log("[Tailscale] retry via startLogin");
        const loginResult = await startLogin(tsHostname);
        if (loginResult.authUrl) return { success: false, needsLogin: true, authUrl: loginResult.authUrl };
      }
      throw e;
    }
    throwIfCancelled(token, "tailscale");

    if (result.funnelNotEnabled) {
      console.log(`[Tailscale] funnel not enabled, enableUrl=${result.enableUrl}`);
      return { success: false, funnelNotEnabled: true, enableUrl: result.enableUrl };
    }

    // Strict probe: bypass cache so we don't false-negative on first invocation
    if (!isTailscaleLoggedIn() || !isTailscaleRunningStrict()) {
      console.error("[Tailscale] strict probe failed (device removed?)");
      stopFunnel();
      return { success: false, error: "Tailscale not connected. Device may have been removed. Please re-login." };
    }

    await updateSettings({ tailscaleEnabled: true, tailscaleUrl: result.tunnelUrl });
    console.log(`[Tailscale] funnel up: ${result.tunnelUrl}`);

    // Provision TLS cert so Funnel can serve HTTPS (non-fatal if fails)
    const hostname = new URL(result.tunnelUrl).hostname;
    await provisionCert(hostname);

    // Verify funnel serves /api/health — timeout is non-fatal (DNS may still be propagating)
    let reachableNow = false;
    try {
      await waitForHealth(result.tunnelUrl, token);
      reachableNow = true;
    } catch (he) {
      if (!he.message.startsWith("Health check timeout")) throw he;
      console.warn(`[Tailscale] health check timed out, will retry via watchdog`);
    }

    if (reachableNow) {
      tailscaleReachable.value = true;
      tailscaleReachable.url = result.tunnelUrl;
      tailscaleReachable.fetchedAt = Date.now();
    }
    console.log(`[Tailscale] enable success (reachable=${reachableNow})`);
    return { success: true, tunnelUrl: result.tunnelUrl };
  } catch (e) {
    console.error(`[Tailscale] enable error: ${e.message}`);
    throw e;
  } finally {
    tailscaleSvc.spawnInProgress = false;
  }
}

export async function disableTailscale() {
  console.log("[Tailscale] disable");
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
  // Skip probes entirely when disabled; check login before running (device removed = not logged in)
  const loggedIn = settingsEnabled ? isTailscaleLoggedIn() : false;
  const running = loggedIn ? isTailscaleRunning() : false;
  // Reachable: cached background probe (never blocks the request)
  const reachable = settingsEnabled && running ? readReachable(tailscaleReachable, tunnelUrl) : false;
  return {
    enabled: settingsEnabled && running,
    settingsEnabled,
    tunnelUrl,
    running,
    loggedIn,
    reachable
  };
}
