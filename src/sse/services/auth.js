import { getProviderConnections, validateApiKey, updateProviderConnection, getSettings } from "@/lib/localDb";
import { isAccountUnavailable, getUnavailableUntil, getEarliestRateLimitedUntil, formatRetryAfter, checkFallbackError } from "open-sse/services/accountFallback.js";
import { resolveProviderId } from "@/shared/constants/providers.js";
import * as log from "../utils/logger.js";

// Mutex to prevent race conditions during account selection
let selectionMutex = Promise.resolve();

// ---------------------------------------------------------------------------
// Model-level rate-limit locking (in-memory)
//
// Providers like Antigravity maintain *separate* quota buckets per model
// family (e.g. Claude vs Gemini). When a 429 arrives for one model, the
// standard account-level DB lock would block ALL models on that account,
// wasting quota that is still available for other model families.
//
// This module tracks model-specific locks in memory so that only the
// affected model is skipped during account selection while the rest of the
// account's quota remains accessible.
//
// Locks are intentionally in-memory: they clear on restart and require no
// database schema migration.
// ---------------------------------------------------------------------------

/** Providers known to have independent per-model quota buckets */
const MULTI_BUCKET_PROVIDERS = new Set(["antigravity"]);

/** Map<"connectionId:model", expiryTimestamp> */
const modelLocks = new Map();

/** Default lock duration for model-level rate limits (5 minutes) */
const DEFAULT_MODEL_LOCK_MS = 5 * 60 * 1000;

/**
 * Check whether a specific model is temporarily locked on a connection.
 * Expired locks are cleaned up lazily.
 */
function isModelLocked(connectionId, model) {
  if (!connectionId || !model) return false;
  const key = `${connectionId}:${model}`;
  const expiry = modelLocks.get(key);
  if (!expiry) return false;
  if (expiry > Date.now()) return true;
  modelLocks.delete(key); // clean up expired
  return false;
}

/**
 * Lock a model on a specific connection for `durationMs` milliseconds.
 */
function lockModel(connectionId, model, durationMs) {
  if (!connectionId || !model) return;
  const key = `${connectionId}:${model}`;
  modelLocks.set(key, Date.now() + durationMs);
  log.warn("AUTH", `Model lock: ${model} on ${connectionId.slice(0, 8)} for ${Math.round(durationMs / 1000)}s`);
}

/**
 * Check whether a provider uses per-model quota buckets.
 */
function isMultiBucketProvider(provider) {
  return MULTI_BUCKET_PROVIDERS.has(provider);
}

/**
 * Get provider credentials from localDb
 * Filters out unavailable accounts and returns the selected account based on strategy
 * @param {string} provider - Provider name
 * @param {string|null} excludeConnectionId - Connection ID to exclude (for retry with next account)
 * @param {string|null} model - Model name for per-model rate limit filtering
 */
export async function getProviderCredentials(provider, excludeConnectionId = null, model = null) {
  // Acquire mutex to prevent race conditions
  const currentMutex = selectionMutex;
  let resolveMutex;
  selectionMutex = new Promise(resolve => { resolveMutex = resolve; });

  try {
    await currentMutex;

    // Resolve alias to provider ID (e.g., "kc" -> "kilocode")
    const providerId = resolveProviderId(provider);

    const connections = await getProviderConnections({ provider: providerId, isActive: true });
    log.debug("AUTH", `${provider} | total connections: ${connections.length}, excludeId: ${excludeConnectionId || "none"}, model: ${model || "any"}`);

    if (connections.length === 0) {
      // Check all connections (including inactive) to see if rate limited
      const allConnections = await getProviderConnections({ provider: providerId });
      log.debug("AUTH", `${provider} | all connections (incl inactive): ${allConnections.length}`);
      if (allConnections.length > 0) {
        const earliest = getEarliestRateLimitedUntil(allConnections);
        if (earliest) {
          log.warn("AUTH", `${provider} | all ${allConnections.length} accounts rate limited (${formatRetryAfter(earliest)})`);
          return { allRateLimited: true, retryAfter: earliest, retryAfterHuman: formatRetryAfter(earliest) };
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
    const multiBucket = isMultiBucketProvider(provider);
    const availableConnections = connections.filter(c => {
      if (excludeConnectionId && c.id === excludeConnectionId) return false;
      if (isAccountUnavailable(c.rateLimitedUntil)) return false;
      if (multiBucket && model && isModelLocked(c.id, model)) return false;
      return true;
    });

    log.debug("AUTH", `${provider} | available: ${availableConnections.length}/${connections.length}`);
    connections.forEach(c => {
      const excluded = excludeConnectionId && c.id === excludeConnectionId;
      const rateLimited = isAccountUnavailable(c.rateLimitedUntil);
      const modelLocked = multiBucket && model && isModelLocked(c.id, model);
      if (excluded || rateLimited || modelLocked) {
        log.debug("AUTH", `  → ${c.id?.slice(0, 8)} | ${excluded ? "excluded" : ""} ${rateLimited ? `rateLimited until ${c.rateLimitedUntil}` : ""} ${modelLocked ? `modelLocked(${model})` : ""}`);
      }
    });

    if (availableConnections.length === 0) {
      const earliest = getEarliestRateLimitedUntil(connections);
      if (earliest) {
        // Find the connection with the earliest rateLimitedUntil to get its error info
        const rateLimitedConns = connections.filter(c => c.rateLimitedUntil && new Date(c.rateLimitedUntil).getTime() > Date.now());
        const earliestConn = rateLimitedConns.sort((a, b) => new Date(a.rateLimitedUntil) - new Date(b.rateLimitedUntil))[0];
        log.warn("AUTH", `${provider} | all ${connections.length} active accounts rate limited (${formatRetryAfter(earliest)}) | lastErrorCode=${earliestConn?.errorCode}, lastError=${earliestConn?.lastError?.slice(0, 50)}`);
        return {
          allRateLimited: true,
          retryAfter: earliest,
          retryAfterHuman: formatRetryAfter(earliest),
          lastError: earliestConn?.lastError || null,
          lastErrorCode: earliestConn?.errorCode || null
        };
      }
      if (multiBucket && model) {
        log.warn("AUTH", `${provider} | all accounts model-locked for ${model}`);
        return {
          allRateLimited: true,
          retryAfter: new Date(Date.now() + 60000).toISOString(),
          retryAfterHuman: "reset after 1m",
          lastError: `All accounts rate limited for model ${model}`
        };
      }
      log.warn("AUTH", `${provider} | all ${connections.length} accounts unavailable`);
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
 * Mark account as unavailable — reads backoffLevel from DB, calculates cooldown with exponential backoff, saves new level.
 * For multi-bucket providers (e.g. Antigravity), 429 errors lock only the specific model in memory
 * rather than the entire account in the database.
 * @param {string} connectionId
 * @param {number} status - HTTP status code from upstream
 * @param {string} errorText
 * @param {string|null} provider
 * @param {string|null} model - The specific model that triggered the error
 * @returns {{ shouldFallback: boolean, cooldownMs: number }}
 */
export async function markAccountUnavailable(connectionId, status, errorText, provider = null, model = null) {
  // Read current connection to get backoffLevel
  const connections = await getProviderConnections({ provider });
  const conn = connections.find(c => c.id === connectionId);
  const backoffLevel = conn?.backoffLevel || 0;

  const { shouldFallback, cooldownMs, newBackoffLevel } = checkFallbackError(status, errorText, backoffLevel);
  if (!shouldFallback) return { shouldFallback: false, cooldownMs: 0 };

  if (isMultiBucketProvider(provider) && status === 429 && model) {
    const lockDuration = cooldownMs > 0 ? cooldownMs : DEFAULT_MODEL_LOCK_MS;
    lockModel(connectionId, model, lockDuration);
    return { shouldFallback: true, cooldownMs: 0 };
  }

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
  log.info("AUTH", `Account ${connectionId.slice(0, 8)} error cleared`);
}

/**
 * Extract API key from request headers
 */
export function extractApiKey(request) {
  // Check Authorization header first
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  // Check Anthropic x-api-key header
  const xApiKey = request.headers.get("x-api-key");
  if (xApiKey) {
    return xApiKey;
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
