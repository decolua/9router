import { getProviderConnections, validateApiKey, updateProviderConnection, getSettings } from "@/lib/localDb";
import { isAccountUnavailable, getUnavailableUntil, getEarliestRateLimitedUntil, formatRetryAfter, checkFallbackError } from "open-sse/services/accountFallback.js";
import * as semaphore from "open-sse/services/rateLimitSemaphore.js";
import * as log from "../utils/logger.js";

// Mutex to prevent race conditions during account selection
let selectionMutex = Promise.resolve();

// In-memory round-robin counter per provider (resets on server restart)
const rrCounters = new Map();

/**
 * Get provider credentials from localDb
 * Filters out unavailable accounts and returns the selected account based on strategy.
 *
 * When strategy is "round-robin", a semaphore slot is acquired for the selected account.
 * The caller MUST call `result.release()` when the request finishes (on both success and error).
 * For "fill-first" strategy, `release` is a no-op.
 *
 * @param {string} provider - Provider name
 * @param {string|null} excludeConnectionId - Connection ID to exclude (for retry with next account)
 * @returns {Promise<Object|null>} Credentials object with `release()` function, or null
 */
export async function getProviderCredentials(provider, excludeConnectionId = null) {
  // Acquire mutex to prevent race conditions
  const currentMutex = selectionMutex;
  let resolveMutex;
  selectionMutex = new Promise(resolve => { resolveMutex = resolve; });

  try {
    await currentMutex;

    const connections = await getProviderConnections({ provider, isActive: true });
    log.debug("AUTH", `${provider} | total connections: ${connections.length}, excludeId: ${excludeConnectionId || "none"}`);

    if (connections.length === 0) {
      // Check all connections (including inactive) to see if rate limited
      const allConnections = await getProviderConnections({ provider });
      log.debug("AUTH", `${provider} | all connections (incl inactive): ${allConnections.length}`);
      if (allConnections.length > 0) {
        const earliest = getEarliestRateLimitedUntil(allConnections);
        if (earliest) {
          log.warn("AUTH", `${provider} | all ${allConnections.length} accounts rate limited (${formatRetryAfter(earliest)})`);
          return { allRateLimited: true, retryAfter: earliest, retryAfterHuman: formatRetryAfter(earliest), release: () => {} };
        }
        log.warn("AUTH", `${provider} | ${allConnections.length} accounts found but none active`);
        allConnections.forEach(c => {
          log.debug("AUTH", `  → ${c.id?.slice(0, 8)} | isActive=${c.isActive} | rateLimitedUntil=${c.rateLimitedUntil || "none"} | testStatus=${c.testStatus}`);
        });
      }
      log.warn("AUTH", `No credentials for ${provider}`);
      return null;
    }

    // Filter out unavailable accounts and excluded connection
    const availableConnections = connections.filter(c => {
      if (excludeConnectionId && c.id === excludeConnectionId) return false;
      if (isAccountUnavailable(c.rateLimitedUntil)) return false;
      return true;
    });

    log.debug("AUTH", `${provider} | available: ${availableConnections.length}/${connections.length}`);
    connections.forEach(c => {
      const excluded = excludeConnectionId && c.id === excludeConnectionId;
      const rateLimited = isAccountUnavailable(c.rateLimitedUntil);
      if (excluded || rateLimited) {
        log.debug("AUTH", `  → ${c.id?.slice(0, 8)} | ${excluded ? "excluded" : ""} ${rateLimited ? `rateLimited until ${c.rateLimitedUntil}` : ""}`);
      }
    });

    if (availableConnections.length === 0) {
      const earliest = getEarliestRateLimitedUntil(connections);
      if (earliest) {
        const rateLimitedConns = connections.filter(c => c.rateLimitedUntil && new Date(c.rateLimitedUntil).getTime() > Date.now());
        const earliestConn = rateLimitedConns.sort((a, b) => new Date(a.rateLimitedUntil) - new Date(b.rateLimitedUntil))[0];
        log.warn("AUTH", `${provider} | all ${connections.length} active accounts rate limited (${formatRetryAfter(earliest)}) | lastErrorCode=${earliestConn?.errorCode}, lastError=${earliestConn?.lastError?.slice(0, 50)}`);
        return {
          allRateLimited: true,
          retryAfter: earliest,
          retryAfterHuman: formatRetryAfter(earliest),
          lastError: earliestConn?.lastError || null,
          lastErrorCode: earliestConn?.errorCode || null,
          release: () => {}
        };
      }
      log.warn("AUTH", `${provider} | all ${connections.length} accounts unavailable`);
      return null;
    }

    const settings = await getSettings();
    const strategy = settings.fallbackStrategy || "fill-first";

    let connection;
    let releaseFn = () => {};
    let slotAcquired = false;

    if (strategy === "round-robin" && availableConnections.length > 1) {
      // Round-robin: circular selection using in-memory counter (no DB writes)
      const counter = rrCounters.get(provider) || 0;
      rrCounters.set(provider, counter + 1);
      const index = counter % availableConnections.length;
      connection = availableConnections[index];

      // Acquire semaphore slot for this account
      const concurrency = settings.concurrencyPerAccount ?? 3;
      const queueTimeout = settings.queueTimeoutMs ?? 30000;

      try {
        releaseFn = await semaphore.acquire(`account:${connection.id}`, {
          maxConcurrency: concurrency,
          timeoutMs: queueTimeout,
        });
        slotAcquired = true;
        log.debug("AUTH", `${provider} | RR #${counter} → account ${connection.id?.slice(0, 8)} (slot acquired)`);
      } catch (err) {
        if (err.code === "SEMAPHORE_TIMEOUT") {
          // Current account is overloaded — try next available
          log.warn("AUTH", `${provider} | semaphore timeout for account ${connection.id?.slice(0, 8)}, trying next`);
          for (let offset = 1; offset < availableConnections.length; offset++) {
            const altIndex = (index + offset) % availableConnections.length;
            const alt = availableConnections[altIndex];
            try {
              releaseFn = await semaphore.acquire(`account:${alt.id}`, {
                maxConcurrency: concurrency,
                timeoutMs: Math.min(queueTimeout, 5000), // shorter timeout for fallback attempts
              });
              slotAcquired = true;
              connection = alt;
              log.debug("AUTH", `${provider} | RR fallback → account ${alt.id?.slice(0, 8)} (slot acquired)`);
              break;
            } catch {
              continue;
            }
          }
          if (!slotAcquired) {
            log.warn("AUTH", `${provider} | all account semaphores full, proceeding without slot`);
          }
        } else {
          throw err;
        }
      }
    } else if (strategy === "round-robin" && availableConnections.length === 1) {
      // Only 1 account: no rotation needed, but still apply semaphore
      connection = availableConnections[0];
      const concurrency = settings.concurrencyPerAccount ?? 3;
      const queueTimeout = settings.queueTimeoutMs ?? 30000;
      try {
        releaseFn = await semaphore.acquire(`account:${connection.id}`, {
          maxConcurrency: concurrency,
          timeoutMs: queueTimeout,
        });
        slotAcquired = true;
      } catch (err) {
        if (err.code !== "SEMAPHORE_TIMEOUT") throw err;
        log.warn("AUTH", `${provider} | semaphore timeout for single account, proceeding without slot`);
      }
    } else {
      // Default: fill-first (already sorted by priority in getProviderConnections)
      connection = availableConnections[0];
    }

    return {
      apiKey: connection.apiKey,
      accessToken: connection.accessToken,
      refreshToken: connection.refreshToken,
      projectId: connection.projectId,
      copilotToken: connection.providerSpecificData?.copilotToken,
      providerSpecificData: connection.providerSpecificData,
      connectionId: connection.id,
      // Include current status for optimization check
      testStatus: connection.testStatus,
      lastError: connection.lastError,
      rateLimitedUntil: connection.rateLimitedUntil,
      // Semaphore release function — caller MUST call this when request finishes
      release: releaseFn,
    };
  } finally {
    if (resolveMutex) resolveMutex();
  }
}

/**
 * Mark account as unavailable — reads backoffLevel from DB, calculates cooldown with exponential backoff, saves new level
 * @returns {{ shouldFallback: boolean, cooldownMs: number }}
 */
export async function markAccountUnavailable(connectionId, status, errorText, provider = null) {
  // Read current connection to get backoffLevel
  const connections = await getProviderConnections({ provider });
  const conn = connections.find(c => c.id === connectionId);
  const backoffLevel = conn?.backoffLevel || 0;

  const { shouldFallback, cooldownMs, newBackoffLevel } = checkFallbackError(status, errorText, backoffLevel);
  if (!shouldFallback) return { shouldFallback: false, cooldownMs: 0 };

  const rateLimitedUntil = getUnavailableUntil(cooldownMs);
  const reason = typeof errorText === "string" ? errorText.slice(0, 100) : "Provider error";

  await updateProviderConnection(connectionId, {
    rateLimitedUntil,
    testStatus: "unavailable",
    lastError: reason,
    errorCode: status,
    lastErrorAt: new Date().toISOString(),
    backoffLevel: newBackoffLevel ?? backoffLevel
  });

  // Also mark in semaphore so queued requests pause during cooldown
  if (cooldownMs > 0) {
    semaphore.markRateLimited(`account:${connectionId}`, cooldownMs);
  }

  if (provider && status && reason) {
    console.error(`❌ ${provider} [${status}]: ${reason}`);
  }

  return { shouldFallback: true, cooldownMs };
}

/**
 * Clear account error status (only if currently has error)
 * Optimized to avoid unnecessary DB updates
 */
export async function clearAccountError(connectionId, currentConnection) {
  // Only update if currently has error status
  const hasError = currentConnection.testStatus === "unavailable" ||
                   currentConnection.lastError ||
                   currentConnection.rateLimitedUntil;
  
  if (!hasError) return; // Skip if already clean
  
  await updateProviderConnection(connectionId, {
    testStatus: "active",
    lastError: null,
    lastErrorAt: null,
    rateLimitedUntil: null,
    backoffLevel: 0
  });
  log.info("AUTH", `Account ${connectionId.slice(0,8)} error cleared`);
}

/**
 * Extract API key from request headers
 */
export function extractApiKey(request) {
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  return null;
}

/**
 * Validate API key (optional - for local use can skip)
 */
export async function isValidApiKey(apiKey) {
  if (!apiKey) return false;
  return await validateApiKey(apiKey);
}
