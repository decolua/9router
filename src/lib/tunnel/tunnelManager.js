import { loadState, saveState, generateShortId, clearPid } from "./state.js";
import { spawnQuickTunnel, killCloudflared, isCloudflaredRunning, setUnexpectedExitHandler } from "./cloudflared.js";
import { startFunnel, stopFunnel, isTailscaleRunning, isTailscaleRunningStrict, isTailscaleLoggedIn, startLogin, startDaemonWithPassword, provisionCert } from "./tailscale.js";
import { getSettings, updateSettings } from "@/lib/localDb";
import { getCachedPassword, loadEncryptedPassword, initDbHooks } from "@/mitm/manager";
import { waitForHealth, probeUrlAlive } from "./networkProbe.js";

initDbHooks(getSettings, updateSettings);

const WORKER_URL = process.env.TUNNEL_WORKER_URL || "https://abc-tunnel.us";

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

// Callback invoked when cloudflared exits unexpectedly (set by initializeApp)
let onTunnelUnexpectedExit = null;
export function setTunnelUnexpectedExitCallback(cb) { onTunnelUnexpectedExit = cb; }

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
      if (existing?.tunnelUrl && existing?.shortId) {
        const publicUrl = `https://r${existing.shortId}.abc-tunnel.us`;
        // Reuse only if BOTH direct + public URL alive (avoid stale socket after network change)
        const [directOk, publicOk] = await Promise.all([
          probeUrlAlive(existing.tunnelUrl),
          probeUrlAlive(publicUrl),
        ]);
        if (directOk && publicOk) {
          console.log(`[Tunnel] already running, reuse: ${existing.tunnelUrl}`);
          return { success: true, tunnelUrl: existing.tunnelUrl, shortId: existing.shortId, publicUrl, alreadyRunning: true };
        }
        console.log(`[Tunnel] stale (direct=${directOk} public=${publicOk}), respawn`);
      }
    }

    killCloudflared(localPort);
    console.log("[Tunnel] killed existing cloudflared");
    throwIfCancelled(token, "tunnel");

    const existing = loadState();
    const shortId = existing?.shortId || generateShortId();

    const onUrlUpdate = async (url) => {
      if (token.cancelled) return;
      console.log(`[Tunnel] url updated: ${url}`);
      await registerTunnelUrl(shortId, url);
      saveState({ shortId, tunnelUrl: url });
      await updateSettings({ tunnelEnabled: true, tunnelUrl: url });
    };

    // Register exit handler BEFORE spawn so it fires even on early exit
    setUnexpectedExitHandler(() => {
      console.warn("[Tunnel] cloudflared exited unexpectedly, scheduling respawn");
      if (onTunnelUnexpectedExit) onTunnelUnexpectedExit();
    });

    const { tunnelUrl } = await spawnQuickTunnel(localPort, onUrlUpdate);
    console.log(`[Tunnel] spawned: ${tunnelUrl}`);
    throwIfCancelled(token, "tunnel");

    const publicUrl = `https://r${shortId}.abc-tunnel.us`;
    await registerTunnelUrl(shortId, tunnelUrl);
    saveState({ shortId, tunnelUrl });
    await updateSettings({ tunnelEnabled: true, tunnelUrl });
    console.log(`[Tunnel] registered shortId=${shortId} publicUrl=${publicUrl}`);

    // Verify publicUrl first (worker route is reliable; direct *.trycloudflare.com DNS may lag)
    await waitForHealth(publicUrl, token);
    console.log("[Tunnel] public URL healthy");
    // Direct tunnel probe is best-effort: DNS for *.trycloudflare.com can be slow/blocked on some networks
    if (!(await probeUrlAlive(tunnelUrl))) {
      console.warn("[Tunnel] direct URL not reachable yet, continuing via publicUrl");
    } else {
      console.log("[Tunnel] direct URL healthy");
    }

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
  // Abort any in-flight enable so it cannot resurrect state after we clear it
  tunnelSvc.cancelToken.cancelled = true;
  setUnexpectedExitHandler(null);

  try { killCloudflared(tunnelSvc.activeLocalPort); } catch (e) { console.warn(`[Tunnel] kill warn: ${e.message}`); }
  clearPid();

  const state = loadState();
  if (state) saveState({ shortId: state.shortId, tunnelUrl: null });

  await updateSettings({ tunnelEnabled: false, tunnelUrl: "" });
  // Force-clear flags so a subsequent enable is not blocked by a stuck spawnInProgress
  tunnelSvc.spawnInProgress = false;
  tunnelSvc.activeLocalPort = null;
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

  return {
    enabled: settingsEnabled && running,
    settingsEnabled,
    tunnelUrl,
    shortId,
    publicUrl,
    running
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
  return { success: true };
}

export async function getTailscaleStatus() {
  const settings = await getSettings();
  const settingsEnabled = settings.tailscaleEnabled === true;
  const tunnelUrl = settings.tailscaleUrl || "";
  // Skip probes entirely when disabled; check login before running (device removed = not logged in)
  const loggedIn = settingsEnabled ? isTailscaleLoggedIn() : false;
  const running = loggedIn ? isTailscaleRunning() : false;
  return {
    enabled: settingsEnabled && running,
    settingsEnabled,
    tunnelUrl,
    running,
    loggedIn
  };
}
