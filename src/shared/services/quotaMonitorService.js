/**
 * Background quota monitor service.
 * Polls quota for connections with minReserve/cooldown enabled
 * and updates in-memory reserve state.
 */
import { getProviderConnections } from "@/lib/localDb";
import { getUsageForProvider } from "open-sse/services/usage.js";
import { refreshAndUpdateCredentials } from "@/shared/services/credentialRefresh";
import { computeMinRemainingPercent } from "@/shared/utils/quotaPercent";
import {
  getReserveState,
  setReserveState,
  clearReserveState,
} from "@/shared/services/quotaReserveState";
import { USAGE_SUPPORTED_PROVIDERS } from "@/shared/constants/providers";

const MONITOR_INTERVAL_MS = 60_000; // 60 seconds
const FETCH_TIMEOUT_MS = 15_000;    // 15 seconds per connection

const g = (global.__appSingleton ??= {});

/**
 * Start the background quota monitor. Follows the same pattern as
 * startWatchdog() / startNetworkMonitor() in initializeApp.js.
 */
export function startQuotaMonitor() {
  if (g.quotaMonitorInterval) return;

  console.log("[QuotaMonitor] Starting background quota monitor (60s interval)");

  // Run first tick after a short delay to let the app finish initializing
  setTimeout(() => monitorTick(), 5_000);

  g.quotaMonitorInterval = setInterval(() => monitorTick(), MONITOR_INTERVAL_MS);
  if (g.quotaMonitorInterval.unref) g.quotaMonitorInterval.unref();
}

/**
 * Single monitor tick — poll all relevant connections.
 */
async function monitorTick() {
  try {
    const connections = await getRelevantConnections();
    if (connections.length === 0) return;

    // Process connections in parallel with timeout
    await Promise.allSettled(
      connections.map((conn) => processConnectionWithTimeout(conn))
    );
  } catch (err) {
    console.error("[QuotaMonitor] Tick error:", err.message);
  }
}

/**
 * Get connections that need quota monitoring.
 */
async function getRelevantConnections() {
  const allConnections = await getProviderConnections({ isActive: true });
  return allConnections.filter((c) => {
    if (c.authType !== "oauth") return false;
    if (!USAGE_SUPPORTED_PROVIDERS.includes(c.provider)) return false;
    if (!c.minReserveEnabled && !c.cooldownEnabled) return false;
    return true;
  });
}

/**
 * Process a single connection with timeout guard.
 */
async function processConnectionWithTimeout(conn) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    await processConnection(conn);
  } catch (err) {
    if (err.name === "AbortError") {
      console.warn(`[QuotaMonitor] Timeout fetching quota for ${conn.name || conn.id.slice(0, 8)}`);
    } else {
      console.warn(`[QuotaMonitor] Error for ${conn.name || conn.id.slice(0, 8)}: ${err.message}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Core logic: fetch quota for a connection and update reserve state.
 */
async function processConnection(conn) {
  // Refresh credentials if needed
  let connection = conn;
  try {
    const result = await refreshAndUpdateCredentials(connection);
    connection = result.connection;
  } catch (err) {
    // Credential refresh failed — skip this connection for this tick
    return;
  }

  // Fetch usage data
  const usageData = await getUsageForProvider(connection);
  if (!usageData || usageData.message) return; // No usable quota data

  // Compute minimum remaining % across all quota windows
  const minRemaining = computeMinRemainingPercent(conn.provider, usageData);
  if (minRemaining === null) return; // No parseable quota data

  const prevState = getReserveState(conn.id);
  const wasBlocked = prevState?.quotaReserveBlocked === true;
  const threshold = conn.minReservePercent || 15;
  const connName = conn.name || conn.email || conn.id.slice(0, 8);

  // --- Transition logic ---

  if (conn.minReserveEnabled && minRemaining <= threshold && !wasBlocked) {
    // Quota dropped below threshold → block
    console.warn(`[QuotaMonitor] ${connName}: reserve threshold reached (${minRemaining}% <= ${threshold}%) — blocking`);
    setReserveState(conn.id, {
      quotaReserveBlocked: true,
      cooldownUntil: prevState?.cooldownUntil || null,
      minRemainingPercent: minRemaining,
    });
    return;
  }

  if (wasBlocked && minRemaining > threshold) {
    // Was blocked, quota has reset (now above threshold) → unblock + maybe start cooldown
    if (conn.cooldownEnabled) {
      const cooldownMs = (conn.cooldownMinutes || 30) * 60_000;
      const cooldownUntil = Date.now() + cooldownMs;
      console.warn(`[QuotaMonitor] ${connName}: quota reset (${minRemaining}%) — starting ${conn.cooldownMinutes || 30}min cooldown`);
      setReserveState(conn.id, {
        quotaReserveBlocked: false,
        cooldownUntil,
        minRemainingPercent: minRemaining,
      });
    } else {
      console.info(`[QuotaMonitor] ${connName}: quota reset (${minRemaining}%) — unblocking`);
      setReserveState(conn.id, {
        quotaReserveBlocked: false,
        cooldownUntil: null,
        minRemainingPercent: minRemaining,
      });
    }
    return;
  }

  // --- Cooldown expiry check ---
  const cooldownUntil = prevState?.cooldownUntil;
  if (cooldownUntil) {
    const now = Date.now();
    const maxCooldown = (conn.cooldownMinutes || 30) * 60_000 * 2; // safety: 2x configured
    if (now > cooldownUntil || cooldownUntil > now + maxCooldown) {
      // Cooldown expired or corrupted → clear
      setReserveState(conn.id, {
        quotaReserveBlocked: false,
        cooldownUntil: null,
        minRemainingPercent: minRemaining,
      });
      return;
    }
  }

  // --- Update remaining % for UI display ---
  setReserveState(conn.id, {
    quotaReserveBlocked: wasBlocked,
    cooldownUntil: prevState?.cooldownUntil || null,
    minRemainingPercent: minRemaining,
  });
}
