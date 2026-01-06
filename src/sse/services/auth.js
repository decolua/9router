import { getProviderConnections, validateApiKey, updateProviderConnection, getSettings } from "@/lib/localDb";
import { isAccountUnavailable, getUnavailableUntil } from "open-sse/services/accountFallback.js";
import * as log from "../utils/logger.js";

// Mutex to prevent race conditions during account selection
let selectionMutex = Promise.resolve();

/**
 * Get provider credentials from localDb
 * Filters out unavailable accounts and returns the selected account based on strategy
 * @param {string} provider - Provider name
 * @param {string|null} excludeConnectionId - Connection ID to exclude (for retry with next account)
 */
export async function getProviderCredentials(provider, excludeConnectionId = null) {
  // Acquire mutex to prevent race conditions
  const currentMutex = selectionMutex;
  let resolveMutex;
  selectionMutex = new Promise(resolve => { resolveMutex = resolve; });

  try {
    await currentMutex;

    const connections = await getProviderConnections({ provider, isActive: true });

    if (connections.length === 0) {
      log.warn("AUTH", `No credentials for ${provider}`);
      return null;
    }

    // Filter out unavailable accounts and excluded connection
    const availableConnections = connections.filter(c => {
      if (excludeConnectionId && c.id === excludeConnectionId) return false;
      if (isAccountUnavailable(c.rateLimitedUntil)) return false;
      return true;
    });

    if (availableConnections.length === 0) {
      log.warn("AUTH", `All ${connections.length} accounts for ${provider} unavailable`);
      return null;
    }

    const settings = await getSettings();
    const strategy = settings.fallbackStrategy || "fill-first";

    let connection;
    if (strategy === "round-robin") {
      const stickyLimit = settings.stickyRoundRobinLimit || 3;

      // Sort by lastUsed (most recent first) to find current candidate
      const byRecency = [...availableConnections].sort((a, b) => {
        if (!a.lastUsedAt && !b.lastUsedAt) return (a.priority || 999) - (b.priority || 999);
        if (!a.lastUsedAt) return 1;
        if (!b.lastUsedAt) return -1;
        return new Date(b.lastUsedAt) - new Date(a.lastUsedAt);
      });

      const current = byRecency[0];
      const currentCount = current?.consecutiveUseCount || 0;

      if (current && current.lastUsedAt && currentCount < stickyLimit) {
        // Stay with current account
        connection = current;
        // Update lastUsedAt and increment count (await to ensure persistence)
        await updateProviderConnection(connection.id, {
          lastUsedAt: new Date().toISOString(),
          consecutiveUseCount: (connection.consecutiveUseCount || 0) + 1
        });
      } else {
        // Pick the least recently used (excluding current if possible)
        const sortedByOldest = [...availableConnections].sort((a, b) => {
          if (!a.lastUsedAt && !b.lastUsedAt) return (a.priority || 999) - (b.priority || 999);
          if (!a.lastUsedAt) return -1;
          if (!b.lastUsedAt) return 1;
          return new Date(a.lastUsedAt) - new Date(b.lastUsedAt);
        });

        connection = sortedByOldest[0];

        // Update lastUsedAt and reset count to 1 (await to ensure persistence)
        await updateProviderConnection(connection.id, {
          lastUsedAt: new Date().toISOString(),
          consecutiveUseCount: 1
        });
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
      rateLimitedUntil: connection.rateLimitedUntil
    };
  } finally {
    if (resolveMutex) resolveMutex();
  }
}

/**
 * Mark account as unavailable with cooldown
 */
export async function markAccountUnavailable(connectionId, cooldownMs, reason = "Provider error", errorCode = null, provider = null) {
  const rateLimitedUntil = getUnavailableUntil(cooldownMs);
  await updateProviderConnection(connectionId, {
    rateLimitedUntil,
    testStatus: "unavailable",
    lastError: reason,
    errorCode,
    lastErrorAt: new Date().toISOString()
  });
  // log.warn("AUTH", `Account ${connectionId.slice(0,8)} unavailable until ${rateLimitedUntil}`);
  
  // Log to stderr for CLI to display
  if (provider && errorCode && reason) {
    console.error(`❌ ${provider} [${errorCode}]: ${reason}`);
  }
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
    rateLimitedUntil: null
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
