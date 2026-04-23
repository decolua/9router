/**
 * Token Scheduler — Background service for proactive token refresh
 * and auto-recovery of expired/invalid Antigravity accounts.
 *
 * Singleton module. On first import, reads persisted state from settings.
 * Call startScheduler() to begin the periodic check loop.
 *
 * Lifecycle:
 *   1. Every `checkIntervalMs` (default 30 min), runs schedulerTick()
 *   2. Tick loads all active Antigravity connections
 *   3. For each connection:
 *      a. Pre-refresh: if token expires within `preRefreshWindowMs`, refresh it
 *      b. Recovery: if refresh fails with invalid_grant AND stored credentials
 *         exist, attempt headless re-login via Puppeteer
 *   4. Stats and recovery log are persisted to settings.tokenScheduler
 */

import { getProviderConnections, updateProviderConnection, getSettings, updateSettings } from "@/lib/localDb";
import { refreshGoogleToken } from "@/sse/services/tokenRefresh";
import { ANTIGRAVITY_CONFIG } from "@/lib/oauth/constants/oauth";
import { recoverAccount } from "./recovery.js";

// ── Defaults ─────────────────────────────────────────────────────────
const DEFAULT_CHECK_INTERVAL = 30 * 60 * 1000;   // 30 minutes
const DEFAULT_PRE_REFRESH_WINDOW = 60 * 60 * 1000; // 60 minutes
const MAX_LOG_ENTRIES = 100;

// ── Singleton state ──────────────────────────────────────────────────
let _intervalHandle = null;
let _running = false;
let _tickInProgress = false; // mutex guard
let _checkIntervalMs = DEFAULT_CHECK_INTERVAL;
let _preRefreshWindowMs = DEFAULT_PRE_REFRESH_WINDOW;
let _lastCheckAt = null;
let _lastPreRefreshAt = null;
let _totalRecovered = 0;
let _totalFailed = 0;
let _recoveryLog = [];
let _initialized = false;

// ── Helpers ──────────────────────────────────────────────────────────

function addLogEntry(entry) {
  _recoveryLog.unshift({
    timestamp: new Date().toISOString(),
    ...entry,
  });
  if (_recoveryLog.length > MAX_LOG_ENTRIES) {
    _recoveryLog = _recoveryLog.slice(0, MAX_LOG_ENTRIES);
  }
}

async function persistStats() {
  try {
    await updateSettings({
      tokenScheduler: {
        totalRecovered: _totalRecovered,
        totalFailed: _totalFailed,
        recoveryLog: _recoveryLog,
        lastCheckAt: _lastCheckAt,
        lastPreRefreshAt: _lastPreRefreshAt,
        checkIntervalMs: _checkIntervalMs,
        preRefreshWindowMs: _preRefreshWindowMs,
      },
    });
  } catch (e) {
    console.error("[TokenScheduler] Failed to persist stats:", e.message);
  }
}

async function loadPersistedState() {
  if (_initialized) return;
  try {
    const settings = await getSettings();
    const ts = settings.tokenScheduler || {};
    _totalRecovered = ts.totalRecovered || 0;
    _totalFailed = ts.totalFailed || 0;
    _recoveryLog = ts.recoveryLog || [];
    _lastCheckAt = ts.lastCheckAt || null;
    _lastPreRefreshAt = ts.lastPreRefreshAt || null;
    if (ts.checkIntervalMs) _checkIntervalMs = ts.checkIntervalMs;
    if (ts.preRefreshWindowMs) _preRefreshWindowMs = ts.preRefreshWindowMs;
    _initialized = true;
  } catch (e) {
    console.error("[TokenScheduler] Failed to load state:", e.message);
    _initialized = true;
  }
}

// ── Core tick ────────────────────────────────────────────────────────

async function schedulerTick() {
  if (_tickInProgress) {
    console.log("[TokenScheduler] Tick skipped — previous tick still running");
    return { skipped: true };
  }

  _tickInProgress = true;
  const results = { preRefreshed: 0, recovered: 0, failed: 0, errors: [] };

  try {
    const connections = await getProviderConnections({ provider: "antigravity", isActive: true });
    _lastCheckAt = new Date().toISOString();
    console.log(`[TokenScheduler] Tick — checking ${connections.length} connections`);

    for (const conn of connections) {
      try {
        // Phase 1: Pre-refresh check
        if (conn.expiresAt) {
          const expiresAt = new Date(conn.expiresAt).getTime();
          const now = Date.now();
          const timeLeft = expiresAt - now;

          if (timeLeft < _preRefreshWindowMs && timeLeft > 0) {
            console.log(`[TokenScheduler] Pre-refreshing ${conn.email || conn.id.slice(0, 8)} (expires in ${Math.round(timeLeft / 60000)}min)`);

            const tokenResult = await refreshGoogleToken(
              conn.refreshToken,
              ANTIGRAVITY_CONFIG.clientId,
              ANTIGRAVITY_CONFIG.clientSecret,
            );

            if (tokenResult) {
              await updateProviderConnection(conn.id, {
                accessToken: tokenResult.access_token || tokenResult.accessToken,
                refreshToken: tokenResult.refresh_token || tokenResult.refreshToken || conn.refreshToken,
                expiresAt: tokenResult.expires_in
                  ? new Date(Date.now() + tokenResult.expires_in * 1000).toISOString()
                  : conn.expiresAt,
              });
              _lastPreRefreshAt = new Date().toISOString();
              results.preRefreshed++;

              addLogEntry({
                email: conn.email || conn.id.slice(0, 8),
                connectionId: conn.id,
                status: "pre-refreshed",
                message: "Token refreshed proactively",
              });
            } else {
              // Refresh returned null — token might be invalid
              console.log(`[TokenScheduler] Pre-refresh failed for ${conn.email || conn.id.slice(0, 8)} — attempting recovery`);
              await attemptRecovery(conn, results);
            }
            continue;
          }

          // Token already expired
          if (timeLeft <= 0) {
            console.log(`[TokenScheduler] Token expired for ${conn.email || conn.id.slice(0, 8)} — attempting refresh`);
            const tokenResult = await refreshGoogleToken(
              conn.refreshToken,
              ANTIGRAVITY_CONFIG.clientId,
              ANTIGRAVITY_CONFIG.clientSecret,
            );

            if (tokenResult) {
              await updateProviderConnection(conn.id, {
                accessToken: tokenResult.access_token || tokenResult.accessToken,
                refreshToken: tokenResult.refresh_token || tokenResult.refreshToken || conn.refreshToken,
                expiresAt: tokenResult.expires_in
                  ? new Date(Date.now() + tokenResult.expires_in * 1000).toISOString()
                  : null,
                testStatus: "active",
                lastError: null,
              });
              _lastPreRefreshAt = new Date().toISOString();
              results.preRefreshed++;

              addLogEntry({
                email: conn.email || conn.id.slice(0, 8),
                connectionId: conn.id,
                status: "pre-refreshed",
                message: "Expired token refreshed",
              });
            } else {
              await attemptRecovery(conn, results);
            }
            continue;
          }
        }

        // Phase 2: Check connections marked unavailable
        if (conn.testStatus === "unavailable" || conn.testStatus === "error") {
          // Try a simple refresh first
          const tokenResult = await refreshGoogleToken(
            conn.refreshToken,
            ANTIGRAVITY_CONFIG.clientId,
            ANTIGRAVITY_CONFIG.clientSecret,
          );

          if (tokenResult) {
            await updateProviderConnection(conn.id, {
              accessToken: tokenResult.access_token || tokenResult.accessToken,
              refreshToken: tokenResult.refresh_token || tokenResult.refreshToken || conn.refreshToken,
              expiresAt: tokenResult.expires_in
                ? new Date(Date.now() + tokenResult.expires_in * 1000).toISOString()
                : null,
              testStatus: "active",
              lastError: null,
              lastErrorAt: null,
            });
            results.preRefreshed++;

            addLogEntry({
              email: conn.email || conn.id.slice(0, 8),
              connectionId: conn.id,
              status: "recovered",
              message: "Token refresh successful",
            });
            _totalRecovered++;
          } else {
            await attemptRecovery(conn, results);
          }
        }
      } catch (err) {
        console.error(`[TokenScheduler] Error processing ${conn.email || conn.id.slice(0, 8)}:`, err.message);
        results.errors.push({ connectionId: conn.id, email: conn.email, error: err.message });
      }
    }

    await persistStats();
    console.log(`[TokenScheduler] Tick complete — preRefreshed: ${results.preRefreshed}, recovered: ${results.recovered}, failed: ${results.failed}`);
  } catch (err) {
    console.error("[TokenScheduler] Tick error:", err.message);
  } finally {
    _tickInProgress = false;
  }

  return results;
}

async function attemptRecovery(conn, results) {
  const connLabel = conn.email || conn.id.slice(0, 8);
  const hasCredentials = !!conn.providerSpecificData?.encryptedCredentials;

  if (!hasCredentials) {
    console.log(`[TokenScheduler] No stored credentials for ${connLabel} — skipping recovery`);
    addLogEntry({
      email: connLabel,
      connectionId: conn.id,
      status: "skipped",
      message: "No stored credentials for auto-recovery",
    });
    return;
  }

  console.log(`[TokenScheduler] Attempting auto-recovery for ${connLabel}...`);
  const recoveryResult = await recoverAccount(conn, (msg) => {
    console.log(`[TokenScheduler] [${connLabel}] ${msg}`);
  });

  if (recoveryResult.success) {
    _totalRecovered++;
    results.recovered++;
    addLogEntry({
      email: connLabel,
      connectionId: conn.id,
      status: "recovered",
      message: "Auto-login successful",
    });
    console.log(`[TokenScheduler] ✓ Recovered ${connLabel}`);
  } else {
    _totalFailed++;
    results.failed++;
    addLogEntry({
      email: connLabel,
      connectionId: conn.id,
      status: "failed",
      message: recoveryResult.error || "Auto-login failed",
    });
    console.log(`[TokenScheduler] ✗ Recovery failed for ${connLabel}: ${recoveryResult.error}`);
  }
}

// ── Public API ───────────────────────────────────────────────────────

export async function getSchedulerStatus() {
  await loadPersistedState();
  const connections = await getProviderConnections({ provider: "antigravity", isActive: true });
  return {
    status: _running ? "running" : "stopped",
    checkInterval: _checkIntervalMs,
    preRefreshWindow: _preRefreshWindowMs,
    lastCheckAt: _lastCheckAt,
    lastPreRefreshAt: _lastPreRefreshAt,
    credentials: connections.length,
    totalRecovered: _totalRecovered,
    totalFailed: _totalFailed,
    recoveryLog: _recoveryLog,
  };
}

export async function startScheduler() {
  await loadPersistedState();
  if (_intervalHandle) {
    clearInterval(_intervalHandle);
  }
  _running = true;
  _intervalHandle = setInterval(() => {
    schedulerTick().catch((e) => console.error("[TokenScheduler] Unhandled tick error:", e));
  }, _checkIntervalMs);
  console.log(`[TokenScheduler] Started — interval: ${_checkIntervalMs / 60000}min, preRefresh: ${_preRefreshWindowMs / 60000}min`);
}

export function stopScheduler() {
  if (_intervalHandle) {
    clearInterval(_intervalHandle);
    _intervalHandle = null;
  }
  _running = false;
  console.log("[TokenScheduler] Stopped");
}

export async function runNow() {
  await loadPersistedState();
  if (!_running) {
    // Allow manual runs even when stopped
    console.log("[TokenScheduler] Manual run (scheduler is stopped)");
  }
  return await schedulerTick();
}

export async function updateSchedulerSettings({ checkInterval, preRefreshWindow }) {
  await loadPersistedState();
  let needsRestart = false;

  if (checkInterval && checkInterval !== _checkIntervalMs) {
    _checkIntervalMs = checkInterval;
    needsRestart = _running;
  }
  if (preRefreshWindow && preRefreshWindow !== _preRefreshWindowMs) {
    _preRefreshWindowMs = preRefreshWindow;
  }

  await persistStats();

  if (needsRestart) {
    stopScheduler();
    await startScheduler();
  }
}

/**
 * Auto-start the scheduler if Antigravity connections exist.
 * Called from /api/init on server startup and from the panel on first load.
 * Safe to call multiple times — will only start once.
 */
export async function initScheduler() {
  await loadPersistedState();
  if (_running) return; // already running

  try {
    const connections = await getProviderConnections({ provider: "antigravity", isActive: true });
    if (connections.length > 0) {
      console.log(`[TokenScheduler] Auto-starting — ${connections.length} Antigravity account(s) found`);
      await startScheduler();
    } else {
      console.log("[TokenScheduler] No Antigravity accounts — scheduler not started");
    }
  } catch (e) {
    console.error("[TokenScheduler] Auto-start check failed:", e.message);
  }
}
