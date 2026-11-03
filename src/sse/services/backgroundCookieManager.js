// Background Session Cookie Manager for Web Providers (Issue #3355)
// Proactively monitors, validates, and marks web sessions for transparent failover.
// Fail-open everywhere: network hiccups never kill the background interval or mark sessions broken.

import * as log from "../utils/logger.js";
import { WEB_COOKIE_PROVIDERS } from "@/shared/constants/providers.js";

export const DEFAULT_CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
export const MIN_CONNECTION_CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
export const EXPIRY_LEAD_MS = 30 * 60 * 1000; // Check sooner if expiring within 30m
const INITIAL_DELAY_MS = 15 * 1000;

let started = false;
let intervalHandle = null;
let initialTimeoutHandle = null;
let tickRunning = false;

function isTruthyEnv(value) {
  if (value == null || value === "") return false;
  const v = String(value).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function isNonServerRuntime() {
  if (typeof window !== "undefined") return true;
  const phase = process.env.NEXT_PHASE || "";
  if (
    phase === "phase-production-build" ||
    phase === "phase-export" ||
    phase === "phase-static"
  ) {
    return true;
  }
  if (process.env.NEXT_RUNTIME === "edge") return true;
  return false;
}

/**
 * Checks if a connection belongs to a web-cookie or session-based provider.
 * @param {object} connection
 * @returns {boolean}
 */
export function isWebSessionConnection(connection) {
  if (!connection) return false;
  const authType = String(connection.authType || "").toLowerCase().replace(/_/g, "");
  if (authType === "cookie") return true;
  if (connection.provider && WEB_COOKIE_PROVIDERS && WEB_COOKIE_PROVIDERS[connection.provider]) {
    return true;
  }
  if (connection.providerSpecificData?.authMethod === "web-login") {
    return true;
  }
  return false;
}

/**
 * Filter connections that are active and need a health check.
 * @param {Array<object>} connections
 * @param {number} [nowMs]
 * @returns {Array<object>}
 */
export function selectWebConnectionsNeedingCheck(connections, nowMs = Date.now()) {
  if (!Array.isArray(connections) || connections.length === 0) return [];

  const out = [];
  for (const conn of connections) {
    if (!conn || conn.isActive === false) continue;
    if (!isWebSessionConnection(conn)) continue;

    // Check expiry timestamp if present
    const expiresAt = conn.expiresAt ? Date.parse(conn.expiresAt) : null;
    const isExpiringSoon = Number.isFinite(expiresAt) && expiresAt - nowMs < EXPIRY_LEAD_MS;

    // Check time since last check
    const lastCheckAtStr = conn.providerSpecificData?.lastWebCheckAt;
    const lastCheckAt = lastCheckAtStr ? Date.parse(lastCheckAtStr) : null;
    const isDueByInterval = !Number.isFinite(lastCheckAt) || nowMs - lastCheckAt >= MIN_CONNECTION_CHECK_INTERVAL_MS;

    if (isExpiringSoon || isDueByInterval) {
      out.push(conn);
    }
  }

  return out;
}

async function defaultLoadActiveConnections() {
  const { getProviderConnections } = await import("@/lib/db/repos/connectionsRepo.js");
  return getProviderConnections({ isActive: true });
}

async function defaultUpdateConnection(id, data) {
  const { updateProviderConnection } = await import("@/lib/db/repos/connectionsRepo.js");
  return updateProviderConnection(id, data);
}

async function defaultProbe(connection) {
  const { fetchWebIdentity } = await import("open-sse/services/webIdentity.js");
  return fetchWebIdentity(connection.provider, connection.apiKey || "");
}

/**
 * Probes and updates a single web connection.
 * @param {object} connection
 * @param {object} [deps]
 * @returns {Promise<{ valid: boolean, error?: string, inconclusive?: boolean }>}
 */
export async function validateAndRefreshWebConnection(connection, deps = {}) {
  const probe = deps.probe || defaultProbe;
  const updateConnection = deps.updateConnection || defaultUpdateConnection;
  const now = new Date().toISOString();

  try {
    const identity = await probe(connection);
    const existingPsd = connection.providerSpecificData || {};
    const updatedPsd = {
      ...existingPsd,
      lastWebCheckAt: now,
    };

    if (identity.status === "valid") {
      await updateConnection(connection.id, {
        testStatus: "active",
        lastError: null,
        lastErrorAt: null,
        providerSpecificData: updatedPsd,
      });
      return { valid: true };
    }

    if (identity.status === "invalid") {
      const errorMsg = identity.error || "Web session is invalid or expired";
      await updateConnection(connection.id, {
        testStatus: "unavailable",
        lastError: errorMsg,
        lastErrorAt: now,
        providerSpecificData: updatedPsd,
      });
      return { valid: false, error: errorMsg };
    }

    // Inconclusive (transient error / network glitch) -> fail-open
    await updateConnection(connection.id, {
      providerSpecificData: updatedPsd,
    });
    return { valid: true, inconclusive: true, error: identity.error };
  } catch (err) {
    return { valid: true, inconclusive: true, error: err?.message || String(err) };
  }
}

/**
 * Single scheduler tick for web sessions.
 * @param {object} [deps]
 */
export async function runBackgroundCookieManagerTick(deps = {}) {
  if (tickRunning) return;
  tickRunning = true;

  try {
    const load = deps.loadConnections || defaultLoadActiveConnections;
    const validate = deps.validateConnection || validateAndRefreshWebConnection;
    const sleep = deps.sleep || ((ms) => new Promise((res) => setTimeout(res, ms)));

    const connections = await load();
    const due = selectWebConnectionsNeedingCheck(connections, Date.now());

    if (due.length === 0) return;

    const baseDelay = Number(process.env.BG_COOKIE_DELAY_MS) || 2000;

    for (let i = 0; i < due.length; i++) {
      const conn = due[i];
      try {
        const result = await validate(conn);
        log.info("BG_COOKIE_MGR", "Web session probe finished", {
          id: conn.id,
          provider: conn.provider,
          valid: result.valid,
        });
      } catch (err) {
        log.warn("BG_COOKIE_MGR", "Web session probe failed (swallowed)", {
          id: conn?.id,
          provider: conn?.provider,
          error: err?.message || String(err),
        });
      }

      if (i < due.length - 1) {
        const jitter = Math.floor(Math.random() * 1000);
        await sleep(baseDelay + jitter);
      }
    }
  } catch (err) {
    log.warn("BG_COOKIE_MGR", "Tick failed (swallowed)", {
      error: err?.message || String(err),
    });
  } finally {
    tickRunning = false;
  }
}

/**
 * Start the background session cookie manager.
 * @param {{ intervalMs?: number }} [opts]
 * @returns {boolean} true if started this call
 */
export function startBackgroundCookieManager({ intervalMs } = {}) {
  if (started) return false;
  if (isTruthyEnv(process.env.DISABLE_BACKGROUND_COOKIE_MANAGER)) return false;
  if (isNonServerRuntime()) return false;

  started = true;
  const period = Number.isFinite(intervalMs) && intervalMs > 0
    ? intervalMs
    : (Number(process.env.BG_COOKIE_CHECK_INTERVAL_MS) || DEFAULT_CHECK_INTERVAL_MS);

  const safeTick = () => {
    runBackgroundCookieManagerTick().catch((err) => {
      log.warn("BG_COOKIE_MGR", "Unhandled tick rejection (swallowed)", {
        error: err?.message || String(err),
      });
    });
  };

  initialTimeoutHandle = setTimeout(safeTick, INITIAL_DELAY_MS);
  if (initialTimeoutHandle?.unref) initialTimeoutHandle.unref();

  intervalHandle = setInterval(safeTick, period);
  if (intervalHandle?.unref) intervalHandle.unref();

  return true;
}

export function stopBackgroundCookieManager() {
  if (initialTimeoutHandle) {
    clearTimeout(initialTimeoutHandle);
    initialTimeoutHandle = null;
  }
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  if (started) {
    started = false;
  }
}
