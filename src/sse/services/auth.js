import { getProviderConnections, validateApiKey, checkApiKeyAccess, updateProviderConnection, getSettings } from "@/lib/localDb";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { formatRetryAfter, checkFallbackError, isModelLockActive, buildModelLockUpdate, getEarliestModelLockUntil } from "open-sse/services/accountFallback.js";
import { MAX_RATE_LIMIT_COOLDOWN_MS } from "open-sse/config/errorConfig.js";
import { resolveProviderId, FREE_PROVIDERS } from "@/shared/constants/providers.js";
import { normalizeAccountRoutingMode } from "@/shared/utils/accountRouting.js";
import { restoreExpiredAutoDisabledConnections } from "@/lib/quota/autoDisable.js";
import * as log from "../utils/logger.js";

// Mutex to prevent race conditions during account selection
let selectionMutex = Promise.resolve();
let lastSelectionTimeMs = 0;

function clampPercentage(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function quotaRemainingPercentage(quota) {
  if (!quota || !quota.total || quota.total <= 0) return null;
  if (quota.remainingPercentage !== undefined && quota.remainingPercentage !== null) {
    return clampPercentage(quota.remainingPercentage);
  }
  const used = Number(quota.used || 0);
  const total = Number(quota.total || 0);
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return null;
  return clampPercentage(((total - used) / total) * 100);
}

function isSessionQuotaRow(quota) {
  const label = String(
    quota?.name ?? quota?.label ?? quota?.window ?? quota?.type ?? "",
  ).toLowerCase();
  if (!label) return false;
  if (label.includes("weekly") || label.includes("daily")) return false;
  return (
    label.includes("session") ||
    label.includes("5h") ||
    label.includes("5-hour") ||
    label.includes("five_hour")
  );
}

function getSessionQuotaScore(connection) {
  const quotas = Array.isArray(connection?.lastQuotaSnapshot?.quotas)
    ? connection.lastQuotaSnapshot.quotas
    : [];
  const sessionRows = quotas.filter(isSessionQuotaRow);
  if (sessionRows.length === 0) return null;

  const percentages = sessionRows
    .map(quotaRemainingPercentage)
    .filter((percentage) => percentage !== null);
  if (percentages.length === 0) return null;

  return Math.round(
    percentages.reduce((sum, percentage) => sum + percentage, 0) / percentages.length,
  );
}

function getQuotaRoutingScore(connection) {
  const sessionScore = getSessionQuotaScore(connection);
  if (sessionScore !== null) return sessionScore;

  const quotas = Array.isArray(connection?.lastQuotaSnapshot?.quotas)
    ? connection.lastQuotaSnapshot.quotas
    : [];
  if (quotas.length === 0) return null;

  const sessionRows = quotas.filter(isSessionQuotaRow);
  const rows = sessionRows.length > 0 ? sessionRows : quotas;
  const percentages = rows
    .map(quotaRemainingPercentage)
    .filter((percentage) => percentage !== null);
  if (percentages.length === 0) return null;

  return Math.round(
    percentages.reduce((sum, percentage) => sum + percentage, 0) / percentages.length,
  );
}

async function markSelectedConnection(connection, consecutiveUseCount = 1) {
  let selectedAtMs = Date.now();
  if (selectedAtMs <= lastSelectionTimeMs) selectedAtMs = lastSelectionTimeMs + 1;
  lastSelectionTimeMs = selectedAtMs;
  await updateProviderConnection(connection.id, {
    lastUsedAt: new Date(selectedAtMs).toISOString(),
    consecutiveUseCount,
  });
}

function sortByPriorityThenOldest(a, b) {
  const priorityDiff = (a.priority || 999) - (b.priority || 999);
  if (priorityDiff !== 0) return priorityDiff;
  if (!a.lastUsedAt && !b.lastUsedAt) return 0;
  if (!a.lastUsedAt) return -1;
  if (!b.lastUsedAt) return 1;
  return new Date(a.lastUsedAt) - new Date(b.lastUsedAt);
}

function sortByOldestThenPriority(a, b) {
  if (!a.lastUsedAt && !b.lastUsedAt) return (a.priority || 999) - (b.priority || 999);
  if (!a.lastUsedAt) return -1;
  if (!b.lastUsedAt) return 1;
  const lastUsedDiff = new Date(a.lastUsedAt) - new Date(b.lastUsedAt);
  if (lastUsedDiff !== 0) return lastUsedDiff;
  return (a.priority || 999) - (b.priority || 999);
}

function pickDefaultConnection(availableConnections) {
  return [...availableConnections].sort(sortByOldestThenPriority)[0] || null;
}

function pickQuotaConnection(availableConnections, direction) {
  const scored = availableConnections
    .map((candidate) => ({
      candidate,
      score: getQuotaRoutingScore(candidate),
    }))
    .filter((entry) => entry.score !== null)
    .sort((a, b) => {
      if (a.score !== b.score) {
        return direction === "lowest" ? a.score - b.score : b.score - a.score;
      }
      return sortByPriorityThenOldest(a.candidate, b.candidate);
    });

  return scored[0]?.candidate || pickDefaultConnection(availableConnections);
}

function pickRandomConnection(availableConnections) {
  if (availableConnections.length === 0) return null;
  return availableConnections[Math.floor(Math.random() * availableConnections.length)] || availableConnections[0];
}

/**
 * Get provider credentials from localDb
 * Filters out unavailable accounts and returns the selected account based on strategy
 * @param {string} provider - Provider name
 * @param {Set<string>|string|null} excludeConnectionIds - Connection ID(s) to exclude (for retry with next account)
 * @param {string|null} model - Model name for per-model rate limit filtering
 */
export async function getProviderCredentials(provider, excludeConnectionIds = null, model = null, options = {}) {
  // Normalize to Set for consistent handling
  const excludeSet = excludeConnectionIds instanceof Set
    ? excludeConnectionIds
    : (excludeConnectionIds ? new Set([excludeConnectionIds]) : new Set());
  const preferredConnectionId = options?.preferredConnectionId || null;
  // Acquire mutex to prevent race conditions
  const currentMutex = selectionMutex;
  let resolveMutex;
  selectionMutex = new Promise(resolve => { resolveMutex = resolve; });

  try {
    await currentMutex;

    // Resolve alias to provider ID (e.g., "kc" -> "kilocode")
    const providerId = resolveProviderId(provider);
    await restoreExpiredAutoDisabledConnections(providerId);

    // Inject a virtual connection for no-auth free providers (with optional proxy pool from settings)
    if (FREE_PROVIDERS[providerId]?.noAuth) {
      const settings = await getSettings();
      const override = (settings.providerStrategies || {})[providerId] || {};
      const resolvedProxy = await resolveConnectionProxyConfig({ proxyPoolId: override.proxyPoolId || "" });
      return {
        id: "noauth",
        connectionName: "Public",
        isActive: true,
        accessToken: "public",
        providerSpecificData: {
          connectionProxyEnabled: resolvedProxy.connectionProxyEnabled,
          connectionProxyUrl: resolvedProxy.connectionProxyUrl,
          connectionNoProxy: resolvedProxy.connectionNoProxy,
          connectionProxyPoolId: resolvedProxy.proxyPoolId || null,
          vercelRelayUrl: resolvedProxy.vercelRelayUrl || "",
        },
      };
    }

    const connections = await getProviderConnections({ provider: providerId, isActive: true });
    log.debug("AUTH", `${provider} | total connections: ${connections.length}, excludeIds: ${excludeSet.size > 0 ? [...excludeSet].join(",") : "none"}, model: ${model || "any"}`);

    if (connections.length === 0) {
      log.warn("AUTH", `No credentials for ${provider}`);
      return null;
    }

    // Filter out model-locked and excluded connections
    const availableConnections = connections.filter(c => {
      if (excludeSet.has(c.id)) return false;
      if (isModelLockActive(c, model)) return false;
      return true;
    });

    log.debug("AUTH", `${provider} | available: ${availableConnections.length}/${connections.length}`);
    connections.forEach(c => {
      const excluded = excludeSet.has(c.id);
      const locked = isModelLockActive(c, model);
      if (excluded || locked) {
        const lockUntil = getEarliestModelLockUntil(c);
        log.debug("AUTH", `  → ${c.id?.slice(0, 8)} | ${excluded ? "excluded" : ""} ${locked ? `modelLocked(${model}) until ${lockUntil}` : ""}`);
      }
    });

    if (availableConnections.length === 0) {
      // Find earliest lock expiry across all connections for retry timing
      const lockedConns = connections.filter(c => isModelLockActive(c, model));
      const expiries = lockedConns.map(c => getEarliestModelLockUntil(c)).filter(Boolean);
      const earliest = expiries.sort()[0] || null;
      if (earliest) {
        const earliestConn = lockedConns[0];
        log.warn("AUTH", `${provider} | all ${connections.length} accounts locked for ${model || "all"} (${formatRetryAfter(earliest)}) | lastError=${earliestConn?.lastError?.slice(0, 50)}`);
        return {
          allRateLimited: true,
          retryAfter: earliest,
          retryAfterHuman: formatRetryAfter(earliest),
          lastError: earliestConn?.lastError || null,
          lastErrorCode: earliestConn?.errorCode || null
        };
      }
      log.warn("AUTH", `${provider} | all ${connections.length} accounts unavailable`);
      return null;
    }

    const settings = await getSettings();
    // Per-provider strategy overrides global setting
    const providerOverride = (settings.providerStrategies || {})[providerId] || {};
    const strategy = normalizeAccountRoutingMode(providerOverride.fallbackStrategy || settings.fallbackStrategy);

    let connection;
    // Pin to preferred connection if specified and available
    if (preferredConnectionId) {
      connection = availableConnections.find((c) => c.id === preferredConnectionId);
      if (connection) {
        log.info("AUTH", `${provider} | pinned to ${connection.id?.slice(0, 8)} (${connection.name || connection.email || "unnamed"})`);
      }
    }
    if (!connection) {
      if (strategy === "highest") {
        connection = pickQuotaConnection(availableConnections, "highest");
      } else if (strategy === "lowest") {
        connection = pickQuotaConnection(availableConnections, "lowest");
      } else if (strategy === "random") {
        connection = pickRandomConnection(availableConnections);
      } else {
        connection = pickDefaultConnection(availableConnections);
      }
    }

    if (connection) {
      await markSelectedConnection(connection, (connection.consecutiveUseCount || 0) + 1);
    }

    const resolvedProxy = await resolveConnectionProxyConfig(connection.providerSpecificData || {});

    return {
      authType: connection.authType,
      apiKey: connection.apiKey,
      accessToken: connection.accessToken,
      refreshToken: connection.refreshToken,
      idToken: connection.idToken,
      expiresAt: connection.expiresAt,
      expiresIn: connection.expiresIn,
      lastRefreshAt: connection.lastRefreshAt,
      projectId: connection.projectId,
      connectionName: connection.displayName || connection.name || connection.email || connection.id,
      copilotToken: connection.providerSpecificData?.copilotToken,
      providerSpecificData: {
        ...(connection.providerSpecificData || {}),
        connectionProxyEnabled: resolvedProxy.connectionProxyEnabled,
        connectionProxyUrl: resolvedProxy.connectionProxyUrl,
        connectionNoProxy: resolvedProxy.connectionNoProxy,
        connectionProxyPoolId: resolvedProxy.proxyPoolId || null,
        vercelRelayUrl: resolvedProxy.vercelRelayUrl || "",
      },
      connectionId: connection.id,
      // Include current status for optimization check
      testStatus: connection.testStatus,
      lastError: connection.lastError,
      // Pass full connection for clearAccountError to read modelLock_* keys
      _connection: connection
    };
  } finally {
    if (resolveMutex) resolveMutex();
  }
}

/**
 * Mark account+model as unavailable — locks modelLock_${model} in DB.
 * All errors (429, 401, 5xx, etc.) lock per model, not per account.
 * @param {string} connectionId
 * @param {number} status - HTTP status code from upstream
 * @param {string} errorText
 * @param {string|null} provider
 * @param {string|null} model - The specific model that triggered the error
 * @returns {{ shouldFallback: boolean, cooldownMs: number }}
 */
export async function markAccountUnavailable(connectionId, status, errorText, provider = null, model = null, resetsAtMs = null) {
  if (!connectionId || connectionId === "noauth") return { shouldFallback: false, cooldownMs: 0 };
  const connections = await getProviderConnections({ provider });
  const conn = connections.find(c => c.id === connectionId);
  const backoffLevel = conn?.backoffLevel || 0;

  // Provider-specific precise cooldown (e.g. codex usage_limit_reached resets_at) overrides backoff
  let shouldFallback, cooldownMs, newBackoffLevel;
  if (resetsAtMs && resetsAtMs > Date.now()) {
    shouldFallback = true;
    cooldownMs = Math.min(resetsAtMs - Date.now(), MAX_RATE_LIMIT_COOLDOWN_MS);
    newBackoffLevel = 0;
  } else {
    ({ shouldFallback, cooldownMs, newBackoffLevel } = checkFallbackError(status, errorText, backoffLevel));
  }
  if (!shouldFallback) return { shouldFallback: false, cooldownMs: 0 };

  const reason = typeof errorText === "string" ? errorText.slice(0, 100) : "Provider error";
  const lockUpdate = buildModelLockUpdate(model, cooldownMs);
  const lowerReason = reason.toLowerCase();
  const quotaExhausted =
    status === 402 ||
    lowerReason.includes("quota") ||
    lowerReason.includes("usage limit") ||
    lowerReason.includes("insufficient credit") ||
    lowerReason.includes("billing hard limit");
  const quotaUntil = resetsAtMs && resetsAtMs > Date.now()
    ? new Date(resetsAtMs).toISOString()
    : new Date(Date.now() + cooldownMs).toISOString();
  const settings = await getSettings();
  const quotaAutoToggleEnabled = settings.quotaAutoToggleEnabled !== false;

  await updateProviderConnection(connectionId, {
    ...lockUpdate,
    ...(quotaExhausted && quotaAutoToggleEnabled
      ? {
          isActive: false,
          quotaAutoDisabled: true,
          quotaAutoDisabledAt: new Date().toISOString(),
          quotaAutoDisabledUntil: quotaUntil,
          quotaAutoDisabledReason: reason,
        }
      : {}),
    testStatus: "unavailable",
    lastError: reason,
    errorCode: status,
    lastErrorAt: new Date().toISOString(),
    backoffLevel: newBackoffLevel ?? backoffLevel
  });

  const lockKey = Object.keys(lockUpdate)[0];
  const connName = conn?.displayName || conn?.name || conn?.email || connectionId.slice(0, 8);
  log.warn("AUTH", `${connName} locked ${lockKey} for ${Math.round(cooldownMs / 1000)}s [${status}]`);

  if (provider && status && reason) {
    console.error(`❌ ${provider} [${status}]: ${reason}`);
  }

  return { shouldFallback: true, cooldownMs };
}

/**
 * Clear account error status on successful request.
 * - Clears modelLock_${model} (the model that just succeeded)
 * - Lazy-cleans any other expired modelLock_* keys
 * - Resets error state only if no active locks remain
 * @param {string} connectionId
 * @param {object} currentConnection - credentials object (has _connection) or raw connection
 * @param {string|null} model - model that succeeded
 */
export async function clearAccountError(connectionId, currentConnection, model = null) {
  if (!connectionId || connectionId === "noauth") return;
  const conn = currentConnection._connection || currentConnection;
  const now = Date.now();
  const allLockKeys = Object.keys(conn).filter(k => k.startsWith("modelLock_"));

  if (!conn.testStatus && !conn.lastError && allLockKeys.length === 0) return;

  // Keys to clear: current model's lock + all expired locks
  const keysToClear = allLockKeys.filter(k => {
    if (model && k === `modelLock_${model}`) return true; // succeeded model
    if (model && k === "modelLock___all") return true;    // account-level lock
    const expiry = conn[k];
    return expiry && new Date(expiry).getTime() <= now;   // expired
  });

  if (keysToClear.length === 0 && conn.testStatus !== "unavailable" && !conn.lastError) return;

  // Check if any active locks remain after clearing
  const remainingActiveLocks = allLockKeys.filter(k => {
    if (keysToClear.includes(k)) return false;
    const expiry = conn[k];
    return expiry && new Date(expiry).getTime() > now;
  });

  const clearObj = Object.fromEntries(keysToClear.map(k => [k, null]));

  // Only reset error state if no active locks remain
  if (remainingActiveLocks.length === 0) {
    Object.assign(clearObj, { testStatus: "active", lastError: null, lastErrorAt: null, backoffLevel: 0 });
  }

  await updateProviderConnection(connectionId, clearObj);
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

export async function getApiKeyAccess(apiKey) {
  return await checkApiKeyAccess(apiKey);
}
