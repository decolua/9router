import { createHash } from "crypto";
import { getProviderConnections, validateApiKey, updateProviderConnection, getSettings, getProxyPools } from "@/lib/localDb";
import { resolveConnectionProxyConfig, pickProxyPoolId } from "@/lib/network/connectionProxy";
import { formatRetryAfter, checkFallbackError, isModelLockActive, buildModelLockUpdate, getEarliestModelLockUntil } from "open-sse/services/accountFallback.js";
import { MAX_RATE_LIMIT_COOLDOWN_MS } from "open-sse/config/errorConfig.js";
import { MEMORY_CONFIG } from "open-sse/config/runtimeConfig.js";
import { getModelQuotaFamily, getModelUpstreamId, PROVIDER_ID_TO_ALIAS } from "open-sse/config/providerModels.js";
import { resolveKiroModel } from "open-sse/config/kiroConstants.js";
import { resolveProviderId, FREE_PROVIDERS } from "@/shared/constants/providers.js";
import * as log from "../utils/logger.js";

// Mutex to prevent race conditions during account selection
let selectionMutex = Promise.resolve();
const sessionAffinityState = new Map();

function sessionAffinityDigest(value) {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v || v.length > 256) return null;
  return createHash("sha256").update(v).digest("hex");
}

function canonicalSessionAffinitySlot(providerId, model) {
  const requestedModel = typeof model === "string" && model.trim() ? model.trim() : "__all";
  // Thinking effort is request metadata, not part of the upstream model/account
  // capability slot. Normalize it before both registry and synthetic-alias lookup.
  const canonicalRequestedModel = requestedModel.replace(/\([^()]+\)\s*$/, "").trim() || requestedModel;
  const providerAlias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
  let upstreamModel = getModelUpstreamId(providerAlias, canonicalRequestedModel) || canonicalRequestedModel;
  if (providerId === "kiro") upstreamModel = resolveKiroModel(upstreamModel).upstream;
  const quotaFamily = getModelQuotaFamily(providerAlias, canonicalRequestedModel);
  return quotaFamily ? `${upstreamModel}#${quotaFamily}` : upstreamModel;
}

function sessionAffinityContext(providerId, model, sessionId) {
  const digest = sessionAffinityDigest(sessionId);
  if (!providerId || !digest) return null;
  const slot = canonicalSessionAffinitySlot(providerId, model);
  return { digest, slot, key: `${providerId}:${slot}:${digest}` };
}

function cleanupExpiredSessionAffinities(now = Date.now()) {
  for (const [key, entry] of sessionAffinityState) {
    if (now - entry.lastUsed > MEMORY_CONFIG.sessionTtlMs) sessionAffinityState.delete(key);
  }
}

function rememberSessionAffinity(context, connectionId, now = Date.now()) {
  if (!context || !connectionId) return;
  cleanupExpiredSessionAffinities(now);
  sessionAffinityState.delete(context.key);
  while (sessionAffinityState.size >= MEMORY_CONFIG.sessionAffinityMaxSize) {
    sessionAffinityState.delete(sessionAffinityState.keys().next().value);
  }
  sessionAffinityState.set(context.key, { connectionId, lastUsed: now });
}

function getSessionAffinity(context, now = Date.now()) {
  if (!context) return { connectionId: null, missReason: "no_session" };
  const entry = sessionAffinityState.get(context.key);
  if (!entry) return { connectionId: null, missReason: "new_session" };
  if (now - entry.lastUsed > MEMORY_CONFIG.sessionTtlMs) {
    sessionAffinityState.delete(context.key);
    return { connectionId: null, previousConnectionId: entry.connectionId, missReason: "expired" };
  }
  entry.lastUsed = now;
  sessionAffinityState.delete(context.key);
  sessionAffinityState.set(context.key, entry);
  return { connectionId: entry.connectionId, missReason: null };
}

function deleteSessionAffinity(context, expectedConnectionId) {
  if (!context) return false;
  const entry = sessionAffinityState.get(context.key);
  if (!entry || (expectedConnectionId && entry.connectionId !== expectedConnectionId)) return false;
  sessionAffinityState.delete(context.key);
  return true;
}

function logSessionAffinity(provider, event, context, reason, fromConnectionId, toConnectionId) {
  const transition = fromConnectionId
    ? ` account=${fromConnectionId}->${toConnectionId || "none"}`
    : ` account=${toConnectionId || "none"}`;
  const write = event === "hit" || (event === "miss" && reason !== "expired") ? log.debug : log.info;
  write("AUTH", `${provider} | affinity ${event} session=${context.digest} slot=${context.slot} reason=${reason}${transition}`);
}

export function resetProviderSessionAffinity() {
  sessionAffinityState.clear();
}

const affinityCleanup = setInterval(() => {
  cleanupExpiredSessionAffinities();
}, MEMORY_CONFIG.sessionCleanupIntervalMs);
if (affinityCleanup.unref) affinityCleanup.unref();

const SOFT_AFFINITY_STATUSES = new Set([408, 409, 423, 425, 429, 500, 502, 503, 504]);

export function classifySessionAffinityFailure(status, errorText) {
  const statusCode = Number(status);
  if (SOFT_AFFINITY_STATUSES.has(statusCode)) {
    if (statusCode === 429) return { mode: "soft-escape", reason: "rate_limited" };
    if (statusCode === 408 || statusCode === 504) return { mode: "soft-escape", reason: "timeout" };
    if (statusCode === 423) return { mode: "soft-escape", reason: "locked" };
    return { mode: "soft-escape", reason: "transient_upstream" };
  }
  if (statusCode === 401 || statusCode === 403) return { mode: "hard-rebind", reason: "credential_rejected" };
  if (statusCode === 402) return { mode: "hard-rebind", reason: "quota_exhausted" };
  if (statusCode === 404 || statusCode === 406) return { mode: "hard-rebind", reason: "unsupported_capability" };

  const message = typeof errorText === "string" ? errorText.toLowerCase() : "";
  if (/unsupported|not supported|model not found|capability/.test(message)) {
    return { mode: "hard-rebind", reason: "unsupported_capability" };
  }
  if (/invalid (api )?key|invalid credential|credential.*disabled|account.*disabled|no credentials/.test(message)) {
    return { mode: "hard-rebind", reason: "credential_unavailable" };
  }
  if (/quota (exhausted|depleted)|insufficient quota|billing.*exhausted/.test(message)) {
    return { mode: "hard-rebind", reason: "quota_exhausted" };
  }
  if (/rate limit|too many requests|busy|locked|timeout|timed out|capacity|overloaded/.test(message)) {
    return { mode: "soft-escape", reason: "transient_pressure" };
  }
  return { mode: "soft-escape", reason: "transient_unknown" };
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
  const sessionId = options?.sessionId;
  const affinityFailure = options?.affinityFailure || null;
  // Acquire mutex to prevent race conditions
  const currentMutex = selectionMutex;
  let resolveMutex;
  selectionMutex = new Promise(resolve => { resolveMutex = resolve; });

  try {
    await currentMutex;

    // Resolve alias to provider ID (e.g., "kc" -> "kilocode")
    const providerId = resolveProviderId(provider);
    const affinityContext = sessionAffinityContext(providerId, model, sessionId);

    // Inject a virtual connection for no-auth free providers (with optional proxy pool from settings)
    if (FREE_PROVIDERS[providerId]?.noAuth) {
      const settings = await getSettings();
      const override = (settings.providerStrategies || {})[providerId] || {};
      const strategy = override.rotateStrategy || "none";
      let pickedId = override.proxyPoolId || null;
      if (strategy !== "none") {
        const allPools = await getProxyPools({ isActive: true });
        const poolIds = allPools.filter(p => p.proxyUrl).map(p => p.id);
        pickedId = pickProxyPoolId(poolIds, strategy, providerId);
      }
      const resolvedProxy = await resolveConnectionProxyConfig({ proxyPoolId: pickedId || "" });
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
    let settings = null;
    let providerOverride = null;
    let strategy = null;
    let affinityLookup = null;
    let affinityTransition = null;
    if (affinityContext) {
      settings = await getSettings();
      providerOverride = (settings.providerStrategies || {})[providerId] || {};
      strategy = providerOverride.fallbackStrategy || settings.fallbackStrategy || "fill-first";
      if (strategy === "round-robin") {
        affinityLookup = getSessionAffinity(affinityContext);
        if (
          affinityFailure?.mode === "hard-rebind" &&
          affinityLookup.connectionId === affinityFailure.connectionId &&
          deleteSessionAffinity(affinityContext, affinityFailure.connectionId)
        ) {
          affinityTransition = {
            event: "hard rebind",
            reason: affinityFailure.reason,
            fromConnectionId: affinityFailure.connectionId,
          };
          affinityLookup = { connectionId: null, missReason: affinityFailure.reason };
        }

        if (affinityLookup.connectionId && !connections.some((c) => c.id === affinityLookup.connectionId)) {
          deleteSessionAffinity(affinityContext, affinityLookup.connectionId);
          affinityTransition = {
            event: "hard rebind",
            reason: "account_unavailable",
            fromConnectionId: affinityLookup.connectionId,
          };
          affinityLookup = { connectionId: null, missReason: "account_unavailable" };
        }
      }
    }
    log.debug("AUTH", `${provider} | total connections: ${connections.length}, excludeIds: ${excludeSet.size > 0 ? [...excludeSet].join(",") : "none"}, model: ${model || "any"}`);

    if (connections.length === 0) {
      if (affinityTransition) {
        logSessionAffinity(provider, affinityTransition.event, affinityContext, affinityTransition.reason, affinityTransition.fromConnectionId, null);
      }
      log.warn("AUTH", `No credentials for ${provider}`);
      return null;
    }

    // Model locks are persisted cooldown timestamps, not acquire/release locks.
    // Waiting while holding the selection mutex would serialize unrelated requests,
    // so locked sticky accounts use a request-local soft escape instead of waiting.
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
      if (affinityTransition) {
        logSessionAffinity(provider, affinityTransition.event, affinityContext, affinityTransition.reason, affinityTransition.fromConnectionId, null);
      }
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

    if (!settings) settings = await getSettings();
    if (!providerOverride) providerOverride = (settings.providerStrategies || {})[providerId] || {};
    if (!strategy) strategy = providerOverride.fallbackStrategy || settings.fallbackStrategy || "fill-first";

    let connection;
    // Pin to preferred connection if specified and available
    if (preferredConnectionId) {
      connection = availableConnections.find((c) => c.id === preferredConnectionId);
      if (connection) {
        log.info("AUTH", `${provider} | pinned to ${connection.id?.slice(0, 8)} (${connection.name || connection.email || "unnamed"})`);
      }
    }
    if (connection) {
      if (strategy === "round-robin" && affinityContext) {
        const boundConnectionId = affinityLookup?.connectionId || null;
        if (boundConnectionId && boundConnectionId !== connection.id) {
          logSessionAffinity(provider, "soft escape", affinityContext, "preferred_account", boundConnectionId, connection.id);
        } else if (boundConnectionId) {
          logSessionAffinity(provider, "hit", affinityContext, "preferred_account", null, connection.id);
        } else {
          rememberSessionAffinity(affinityContext, connection.id);
          const transition = affinityTransition || { event: "miss", reason: "preferred_account" };
          logSessionAffinity(provider, transition.event, affinityContext, transition.reason, transition.fromConnectionId, connection.id);
        }
      }
      // skip strategy
    } else if (strategy === "round-robin") {
      const stickyLimit = providerOverride.stickyRoundRobinLimit || settings.stickyRoundRobinLimit || 3;

      const pickOldest = () => {
        const sortedByOldest = [...availableConnections].sort((a, b) => {
          if (!a.lastUsedAt && !b.lastUsedAt) return (a.priority || 999) - (b.priority || 999);
          if (!a.lastUsedAt) return -1;
          if (!b.lastUsedAt) return 1;
          return new Date(a.lastUsedAt) - new Date(b.lastUsedAt);
        });
        return sortedByOldest[0];
      };

      if (affinityContext) {
        const stickyConnectionId = affinityLookup?.connectionId || null;
        connection = stickyConnectionId
          ? availableConnections.find((c) => c.id === stickyConnectionId)
          : null;

        if (connection) {
          logSessionAffinity(provider, "hit", affinityContext, "bound_account_available", null, connection.id);
          await updateProviderConnection(connection.id, {
            lastUsedAt: new Date().toISOString()
          });
        } else {
          connection = pickOldest();
          if (stickyConnectionId) {
            const reason = affinityFailure?.reason || (excludeSet.has(stickyConnectionId) ? "request_excluded" : "temporary_model_lock");
            logSessionAffinity(provider, "soft escape", affinityContext, reason, stickyConnectionId, connection.id);
          } else {
            rememberSessionAffinity(affinityContext, connection.id);
            const transition = affinityTransition || {
              event: "miss",
              reason: affinityLookup?.missReason || "new_session",
              fromConnectionId: affinityLookup?.previousConnectionId,
            };
            logSessionAffinity(provider, transition.event, affinityContext, transition.reason, transition.fromConnectionId, connection.id);
          }
          await updateProviderConnection(connection.id, {
            lastUsedAt: new Date().toISOString(),
            consecutiveUseCount: 1
          });
        }
      } else {
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
          connection = pickOldest();

          // Update lastUsedAt and reset count to 1 (await to ensure persistence)
          await updateProviderConnection(connection.id, {
            lastUsedAt: new Date().toISOString(),
            consecutiveUseCount: 1
          });
        }
      }
    } else {
      // Default: fill-first (already sorted by priority in getProviderConnections)
      connection = availableConnections[0];
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
      _sessionAffinity: affinityContext ? {
        digest: affinityContext.digest,
        slot: affinityContext.slot,
        boundConnectionId: sessionAffinityState.get(affinityContext.key)?.connectionId || null,
        selectedFromAffinity: sessionAffinityState.get(affinityContext.key)?.connectionId === connection.id,
      } : null,
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

  await updateProviderConnection(connectionId, {
    ...lockUpdate,
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
